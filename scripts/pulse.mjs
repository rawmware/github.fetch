#!/usr/bin/env node
// github.fetch pulse: find fresh GitHub repos, write a "run it in your browser" guide for each,
// and make one commit per guide, paced to hit DAILY_TARGET commits per UTC day.
//
//   node scripts/pulse.mjs                 # automatic pacing (what the workflow runs)
//   node scripts/pulse.mjs --commits 5     # make exactly 5 guide commits now
//   node scripts/pulse.mjs --seed scripts/fixtures/seed-search.json --no-git --commits 3
//
// Env: GITHUB_TOKEN, DAILY_TARGET (default 64, never below 60), FORCE_COMMITS.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { buildGuide, commitsOwed, guideMarkdown, normalizeItem } from "./lib/guide.mjs";
import { getRepo, probeRepo, searchRepos } from "./lib/github.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEED = join(ROOT, "data/feed.json");
const README = join(ROOT, "README.md");
const FEED_CAP = 500;
const MIN_TARGET = 60;

const { values: args } = parseArgs({
  options: {
    commits: { type: "string" },
    seed: { type: "string" },
    "no-git": { type: "boolean", default: false },
    now: { type: "string" },
  },
});

const now = args.now ? new Date(args.now) : new Date();
const useGit = !args["no-git"];
const target = Math.max(MIN_TARGET, Number(process.env.DAILY_TARGET) || 64);
const forced = Number(args.commits ?? process.env.FORCE_COMMITS) || 0;

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

function doneToday() {
  if (!useGit) return 0;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  let email = "";
  try { email = git("config", "user.email"); } catch { /* unset */ }
  const log = git("log", `--since=${since}`, "--format=%ae%x09%s");
  return log.split("\n").filter((l) => {
    const [ae, subject = ""] = l.split("\t");
    return subject.startsWith("scout:") && (!email || ae === email);
  }).length;
}

const guidePath = (fullName) => {
  const [o, r] = fullName.toLowerCase().split("/");
  return join(ROOT, "guides", o, `${r}.md`);
};

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

async function loadFeed() {
  try {
    const f = JSON.parse(await readFile(FEED, "utf8"));
    if (f.schemaVersion === 1 && Array.isArray(f.items)) return f;
  } catch { /* first run */ }
  return { schemaVersion: 1, updatedAt: null, totalGuides: 0, items: [] };
}

async function saveFeed(feed) {
  feed.updatedAt = new Date().toISOString();
  feed.items = feed.items.slice(0, FEED_CAP);
  const counts = {};
  for (const g of feed.items) counts[g.level] = (counts[g.level] || 0) + 1;
  feed.levels = counts;
  await writeAtomic(FEED, JSON.stringify(feed, null, 1) + "\n");
}

async function updateReadme(feed) {
  let text;
  try { text = await readFile(README, "utf8"); } catch { return; }
  const start = "<!-- latest:start -->", end = "<!-- latest:end -->";
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < a) return;
  const rows = feed.items.slice(0, 12).map((g) => {
    const [o, r] = g.fullName.toLowerCase().split("/");
    return `| [${g.fullName}](${g.url}) | ${g.stack.label} | ${g.levelText} | [guide](guides/${o}/${r}.md) |`;
  });
  const block = [start, `_${feed.totalGuides} guides written so far · last update ${feed.updatedAt.slice(0, 16).replace("T", " ")} UTC_`, "",
    "| Repo | What it is | In the browser | |", "|---|---|---|---|", ...rows, end].join("\n");
  await writeFile(README, text.slice(0, a) + block + text.slice(b + end.length));
}

async function loadCandidates(feed) {
  let raw = [];
  if (args.seed) {
    const s = JSON.parse(await readFile(args.seed, "utf8"));
    raw = Array.isArray(s) ? s : s.items || [];
  } else {
    const day = (h) => new Date(now - h * 3600e3).toISOString().slice(0, 10);
    const base = "fork:false archived:false mirror:false is:public";
    const queries = [
      `created:>=${day(48)} stars:>=8 ${base}`,
      `created:>=${day(24 * 7)} stars:>=25 ${base}`,
      `created:>=${day(24 * 30)} stars:>=150 ${base}`,
      `pushed:>=${day(24)} created:>=${day(24 * 90)} stars:>=500 ${base}`,
    ];
    for (const q of queries) {
      try { raw.push(...await searchRepos(q)); } catch (e) { console.warn(`! ${e.message}`); }
    }
  }
  const seen = new Set(feed.items.map((g) => g.fullName.toLowerCase()));
  const out = [];
  for (const item of raw) {
    const repo = normalizeItem(item);
    if (!repo) continue;
    const key = repo.fullName.toLowerCase();
    if (seen.has(key) || existsSync(guidePath(repo.fullName))) continue;
    seen.add(key);
    out.push(repo);
  }
  return out;
}

function commit(paths, message) {
  if (!useGit) return console.log(`  (no-git) ${message}`);
  git("add", "--", ...paths);
  git("commit", "--quiet", "-m", message);
  console.log(`  ✓ ${message}`);
}

async function addGuide(feed, repo) {
  const probe = await probeRepo(repo).catch(() => ({ files: [] }));
  const g = buildGuide(repo, probe, new Date().toISOString());
  g.checkedAt = g.addedAt;
  const path = guidePath(repo.fullName);
  await writeAtomic(path, guideMarkdown(g));
  feed.items.unshift(g);
  feed.totalGuides += 1;
  await saveFeed(feed);
  await updateReadme(feed);
  commit([path, FEED, README], `scout: ${repo.fullName} — ${g.stack.label}, ${g.level} in the browser`);
}

/** No new repos left: re-check the stalest guide's star count instead, so the data stays current. */
async function refreshOne(feed) {
  const g = [...feed.items].sort((a, b) => String(a.checkedAt || a.addedAt).localeCompare(String(b.checkedAt || b.addedAt)))[0];
  if (!g) return false;
  const live = await getRepo(g.fullName).catch(() => null);
  if (!live) return false;
  const before = g.stars;
  g.stars = live.stargazers_count | 0;
  g.forks = live.forks_count | 0;
  g.checkedAt = new Date().toISOString();
  await saveFeed(feed);
  await updateReadme(feed);
  const delta = g.stars - before;
  commit([FEED, README], `scout: refresh ${g.fullName} ★${g.stars} (${delta >= 0 ? "+" : ""}${delta})`);
  return true;
}

async function main() {
  const done = doneToday();
  const owed = forced > 0 ? forced : commitsOwed({ now, doneToday: done, target });
  console.log(`pulse ${now.toISOString()} · target ${target}/day · done today ${done} · making ${owed}`);
  if (!owed) return;

  const feed = await loadFeed();
  const candidates = await loadCandidates(feed);
  console.log(`${candidates.length} new repos available`);
  let made = 0;
  for (let i = 0; i < owed; i++) {
    const repo = candidates.shift();
    try {
      if (repo) await addGuide(feed, repo);
      else if (!(await refreshOne(feed))) break;
      made++;
    } catch (e) {
      console.warn(`! ${repo?.fullName || "refresh"}: ${e.message}`);
    }
  }
  console.log(`made ${made} commit(s)`);
  if (made === 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
