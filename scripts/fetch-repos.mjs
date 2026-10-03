#!/usr/bin/env node
// Daily updater: search GitHub for fresh repos, detect the simplest install,
// validate, and write dist/data/repos.json + a history snapshot. (§4)
// Node >= 20, built-ins only.
import { readFile, writeFile, rename, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, readText, pool } from "./lib/http.mjs";
import {
  WINDOWS, buildQueries, dedupeAndSort, dropReason, normalizeRepo,
  pickDeltaBase, applyDeltas, computeStats, compareRepos,
} from "./lib/normalize.mjs";
import {
  extractReadmeCandidates, manifestCandidates, assembleInstall, manifestNames,
  npmCliName, npmBinPath, npmHasPrepare, pyprojectInfo, cargoInfo, cloneCommand, fallbackOption,
  registryTarget, applyRegistryVerdicts,
} from "./lib/install-detect.mjs";
import { validateSnapshot } from "./lib/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.github.com/search/repositories";
const MIN_REPOS = 20;
const HISTORY_KEEP = 30;
const README_NAMES = ["README.md", "readme.md", "Readme.md", "README.MD", "README.markdown", "README.rst", "README"];
const MARKDOWN_README = /\.(md|markdown)$/i;
const MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod", "Dockerfile", "install.sh"];

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        seed: { type: "string" },
        out: { type: "string", default: "dist/data/repos.json" },
        "no-probe": { type: "boolean", default: false },
        limit: { type: "string", default: "200" },
        concurrency: { type: "string", default: "6" },
        now: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    throw new ExitError(2, err.message);
  }
  const v = parsed.values;
  const int = (name, min, max) => {
    const n = Number(v[name]);
    if (!Number.isInteger(n) || n < min || n > max) throw new ExitError(2, `--${name} must be an integer ${min}–${max}`);
    return n;
  };
  let now = Date.now();
  if (v.now !== undefined) {
    now = Date.parse(v.now);
    if (!Number.isFinite(now)) throw new ExitError(2, `--now is not a valid ISO date: ${v.now}`);
  }
  if (v.seed !== undefined && !v.seed) throw new ExitError(2, "--seed needs a file path");
  return {
    help: v.help,
    seed: v.seed,
    out: path.resolve(process.cwd(), v.out),
    probe: !v["no-probe"],
    limit: int("limit", 1, 300),
    concurrency: int("concurrency", 1, 32),
    now,
    nowGiven: v.now !== undefined,
    dryRun: v["dry-run"],
  };
}

const USAGE = `Usage: node scripts/fetch-repos.mjs [--seed <file>] [--out <path>] [--no-probe]
       [--limit <n>] [--concurrency <n>] [--now <iso>] [--dry-run]`;

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z");

// ---------- sources ----------

async function loadSeed(file) {
  let text, st;
  try {
    st = await stat(file);
    text = await readFile(file, "utf8");
  } catch (err) {
    throw new ExitError(1, `cannot read seed file ${file}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ExitError(1, `seed file is not JSON: ${err.message}`);
  }
  const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!items) throw new ExitError(1, "seed file has no items[]");
  const fetched = !Array.isArray(data) && Number.isFinite(Date.parse(data.fetched_at)) ? Date.parse(data.fetched_at) : st.mtimeMs;
  return {
    items,
    snapshotMs: fetched,
    queries: [{ window: "seed", q: Array.isArray(data) ? null : data.query ?? null, returned: items.length, ok: true }],
    warnings: [],
  };
}

function githubWait(res, attempt) {
  const ra = Number(res.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return ra * 1000;
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (res.headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) && reset > 0) {
    return Math.max(0, reset * 1000 - Date.now());
  }
  return [2000, 8000][Math.min(attempt, 1)];
}

async function loadLive(snapshotMs) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) warn("warning: GITHUB_TOKEN is not set; using the unauthenticated search rate limit");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github.fetch-updater",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const items = [];
  const queries = [];
  const warnings = [];
  for (const q of buildQueries(new Date(snapshotMs).toISOString())) {
    const params = new URLSearchParams({ q: q.q, sort: "stars", order: "desc", per_page: String(q.perPage), page: "1" });
    const entry = { window: q.window, q: q.q, sort: "stars", order: "desc", perPage: q.perPage, returned: 0, ok: false };
    try {
      const res = await fetchWithRetry(`${API}?${params}`, {
        headers,
        timeoutMs: 20000,
        attempts: 3,
        delays: [2000, 8000],
        retryStatus: (r) =>
          r.status >= 500 || r.status === 429 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0"),
        waitFor: githubWait,
        maxWaitMs: 60000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body || !Array.isArray(body.items)) throw new Error("response has no items[]");
      items.push(...body.items);
      entry.returned = body.items.length;
      entry.ok = true;
      if (body.incomplete_results) warnings.push(`window ${q.window}: GitHub reported incomplete results`);
    } catch (err) {
      warnings.push(`window ${q.window} failed: ${err.message}`);
    }
    queries.push(entry);
    log(`  ${q.window}: ${entry.ok ? `${entry.returned} items` : "FAILED"}`);
  }
  return { items, snapshotMs, queries, warnings };
}

// ---------- install probing ----------

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function rawBase(repo) {
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${encPath(repo.defaultBranch)}/`;
}

async function getRaw(base, file, maxBytes) {
  const res = await fetchWithRetry(base + encPath(file), {
    headers: { "User-Agent": "github.fetch-updater" },
    timeoutMs: 10000,
    attempts: 2,
    delays: [1500],
  });
  if (res.status === 404) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status} for ${file}`);
  }
  return readText(res, maxBytes);
}

/** Optional fetch: absent or failed both mean null (a missing file never fails the repo). */
async function tryRaw(base, file, maxBytes = 64 * 1024) {
  try {
    return await getRaw(base, file, maxBytes);
  } catch {
    return null;
  }
}

const repoRefRe = (owner, repo) => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`github\\.com[/:]${esc(owner)}/${esc(repo)}(\\.git)?([/#?]|$)`, "i");
};

/** GET a registry document: { status, doc } (status 0 = network failure). */
async function registryGet(url) {
  try {
    const res = await fetchWithRetry(url, {
      headers: { Accept: "application/json", "User-Agent": "github.fetch-updater" },
      timeoutMs: 10000,
      attempts: 1,
    });
    if (res.status !== 200) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: res.status, doc: null };
    }
    return { status: 200, doc: JSON.parse(await readText(res, 16 * 1024 * 1024)) };
  } catch {
    return { status: 0, doc: null };
  }
}

// Verdicts: "ok" (published and points at this repo), "bad" (404, or points
// elsewhere / nowhere), "unknown" (network failure or odd status).
const verdictOf = (status, matches) => (status === 200 ? (matches ? "ok" : "bad") : status === 404 ? "bad" : "unknown");

const registryCache = new Map();
function cached(key, fn) {
  if (!registryCache.has(key)) registryCache.set(key, fn());
  return registryCache.get(key);
}

function npmVerdict(name, owner, repo) {
  return cached(`npm:${name}:${owner}/${repo}`, async () => {
    const { status, doc } = await registryGet(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
    const r = doc && doc.repository;
    const url = typeof r === "string" ? r : r && typeof r.url === "string" ? r.url : "";
    return verdictOf(status, repoRefRe(owner, repo).test(url));
  });
}

function pypiVerdict(name, owner, repo) {
  return cached(`pypi:${name}:${owner}/${repo}`, async () => {
    const { status, doc } = await registryGet(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    const info = (doc && doc.info) || {};
    const urls = Object.values(info.project_urls || {});
    if (typeof info.home_page === "string") urls.push(info.home_page);
    const rx = repoRefRe(owner, repo);
    return verdictOf(status, urls.some((u) => typeof u === "string" && rx.test(u)));
  });
}

async function detectInstall(repo) {
  const base = rawBase(repo);
  let readme = null;
  let readmeFile = null;
  for (const f of README_NAMES) {
    const body = await getRaw(base, f, 256 * 1024);
    if (body !== null) {
      readme = body;
      readmeFile = f;
      break;
    }
  }
  const files = Object.fromEntries(
    await Promise.all(MANIFESTS.map(async (f) => [f, await tryRaw(base, f)])),
  );
  const cargo = cargoInfo(files["Cargo.toml"]);
  files["src/main.rs"] = cargo && !cargo.hasBin && !cargo.hasWorkspace ? await tryRaw(base, "src/main.rs", 1024) : null;
  files["main.go"] = files["go.mod"] !== null ? await tryRaw(base, "main.go", 1024) : null;

  const owner = repo.owner;
  const name = repo.name;
  const npmName = npmCliName(files["package.json"]);
  const py = pyprojectInfo(files["pyproject.toml"]);
  const [npmV, pypiV] = await Promise.all([
    npmName ? npmVerdict(npmName, owner, name) : "unknown",
    py && py.name ? pypiVerdict(py.name, owner, name) : "unknown",
  ]);
  let npmBinPresent;
  const binPath = npmName && npmV !== "ok" && !npmHasPrepare(files["package.json"]) ? npmBinPath(files["package.json"]) : null;
  if (binPath) {
    try {
      npmBinPresent = (await getRaw(base, binPath, 1024)) !== null;
    } catch {
      npmBinPresent = undefined; // unknown: keep the candidate
    }
  }
  const ctx = {
    owner,
    repo: name,
    homepage: repo.homepage,
    defaultBranch: repo.defaultBranch,
    readmeFile,
    manifestNames: manifestNames(files),
    npmVerified: npmV === "ok",
    pypiVerified: pypiV === "ok",
    npmBinPresent,
  };
  let readmeCands = readme !== null && MARKDOWN_README.test(readmeFile) ? extractReadmeCandidates(readme, ctx) : [];
  // Registry guard: README commands that relate to the repo only by package
  // name must not install a missing or someone else's package.
  const verdicts = {};
  await Promise.all(
    readmeCands.map(async (c) => {
      const t = registryTarget(c, ctx);
      if (!t) return;
      verdicts[`${t.registry}:${t.name}`] =
        t.registry === "npm" ? await npmVerdict(t.name, owner, name) : await pypiVerdict(t.name, owner, name);
    }),
  );
  const before = readmeCands.length;
  readmeCands = applyRegistryVerdicts(readmeCands, verdicts, ctx);
  if (readmeCands.length < before) {
    log(`  ${repo.fullName}: dropped ${before - readmeCands.length} README command(s) whose package is missing or not this repo's`);
  }
  const manifestCands = manifestCandidates(files, ctx);
  return assembleInstall(readmeCands, manifestCands, ctx);
}

function fallbackInstall(repo) {
  const clone = cloneCommand(repo.owner, repo.name);
  return { primary: fallbackOption(clone), alternates: [], clone };
}

// ---------- history ----------

const HISTORY_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

async function readHistory(dir) {
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => HISTORY_RE.test(n));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, n), "utf8")));
    } catch {
      /* ignore unreadable history */
    }
  }
  return out;
}

async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function pruneHistory(dir, keep) {
  const names = (await readdir(dir)).filter((n) => HISTORY_RE.test(n)).sort().reverse();
  for (const n of names.slice(keep)) await unlink(path.join(dir, n));
  return Math.max(0, names.length - keep);
}

// ---------- main ----------

export async function run(argv) {
  const t0 = Date.now();
  const opts = parseCli(argv);
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const mode = opts.seed ? "seed" : "live";
  log(`github.fetch updater · mode=${mode} · probe=${opts.probe ? "on" : "off"}`);

  const src = opts.seed ? await loadSeed(path.resolve(process.cwd(), opts.seed)) : await loadLive(opts.now);
  const snapshotAt = isoSeconds(src.snapshotMs);

  const merged = dedupeAndSort(src.items);
  const kept = [];
  let dropped = 0;
  for (const it of merged) {
    if (dropReason(it)) dropped++;
    else kept.push(it);
  }
  const repos = kept.slice(0, opts.limit).map((it) => normalizeRepo(it, { snapshotAt, windows: WINDOWS }));
  log(`  ${merged.length} unique items, ${dropped} filtered, ${repos.length} kept`);
  if (repos.length < MIN_REPOS) {
    throw new ExitError(1, `only ${repos.length} repos after filtering (need >= ${MIN_REPOS}); nothing written`);
  }

  const historyDir = path.join(path.dirname(opts.out), "history");
  applyDeltas(repos, pickDeltaBase(await readHistory(historyDir), snapshotAt));

  if (opts.probe) {
    let done = 0;
    await pool(repos, opts.concurrency, async (r) => {
      try {
        r.install = await detectInstall(r);
      } catch (err) {
        warn(`  install detection failed for ${r.fullName}: ${err.message}`);
        r.install = fallbackInstall(r);
      }
      done++;
      if (done % 10 === 0 || done === repos.length) log(`  probed ${done}/${repos.length}`);
    });
  } else {
    for (const r of repos) r.install = fallbackInstall(r);
  }

  repos.sort(compareRepos);
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date(opts.nowGiven ? opts.now : Date.now()).toISOString(),
    snapshotAt,
    source: { mode, api: API, queries: src.queries, warnings: src.warnings },
    windows: WINDOWS,
    stats: computeStats(repos),
    repos,
  };

  const v = validateSnapshot(snapshot);
  if (!v.ok) {
    for (const e of v.errors.slice(0, 50)) warn(`  invalid: ${e}`);
    throw new ExitError(1, `snapshot failed validation (${v.errors.length} errors); nothing written`);
  }

  let prevNote = "no previous snapshot";
  try {
    const prev = JSON.parse(await readFile(opts.out, "utf8"));
    const before = new Set((prev.repos || []).map((r) => r.fullName));
    const fresh = repos.filter((r) => !before.has(r.fullName)).length;
    prevNote = `${fresh} new repos vs last run (${before.size} before)`;
  } catch {
    /* first run */
  }

  const historyFile = path.join(historyDir, `${snapshotAt.slice(0, 10)}.json`);
  if (!opts.dryRun) {
    await writeAtomic(opts.out, `${JSON.stringify(snapshot, null, 2)}\n`);
    const hist = {
      snapshotAt,
      repos: repos.map((r) => ({ fullName: r.fullName, stars: r.stars, forks: r.forks })),
    };
    await writeAtomic(historyFile, `${JSON.stringify(hist)}\n`);
    const pruned = await pruneHistory(historyDir, HISTORY_KEEP);
    if (pruned) log(`  pruned ${pruned} old history file(s)`);
  }

  const s = snapshot.stats;
  log("");
  log(`mode:        ${mode}${opts.dryRun ? " (dry run — nothing written)" : ""}`);
  log(`snapshotAt:  ${snapshotAt}`);
  log(`repos:       ${s.total} (${s.withOneLiner} with a one-liner, ${s.languages} languages)`);
  log(`byMethod:    ${JSON.stringify(s.byMethod)}`);
  log(`vs last run: ${prevNote}`);
  log(`warnings:    ${src.warnings.length ? src.warnings.join(" | ") : "none"}`);
  if (!opts.dryRun) log(`wrote:       ${path.relative(ROOT, opts.out) || opts.out}, ${path.relative(ROOT, historyFile)}`);
  log(`elapsed:     ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof ExitError) {
        console.error(`error: ${err.message}`);
        if (err.code === 2) console.error(USAGE);
        process.exit(err.code);
      }
      console.error(`error: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    },
  );
}
