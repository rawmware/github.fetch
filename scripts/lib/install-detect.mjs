// Pure install detection: method table, isSafeCommand, README + manifest
// candidates, relation check and assembly. No I/O in this module.

const NAME = "@?[A-Za-z0-9][A-Za-z0-9._/-]*";
const GITURL = "git\\+https://github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\\.git)?";
const ARGS = "( [A-Za-z0-9._/=:@-]+){0,4}";
// npm also accepts the "github:owner/repo" spec that §4.4 B.1 emits for
// unpublished CLIs (NAME alone has no ":" so it could never match it).
const NPM_TARGET = `(${NAME}(@[A-Za-z0-9._^~-]+)?|github:[A-Za-z0-9._-]+/[A-Za-z0-9._-]+)`;

const re = (src, flags = "") => new RegExp(`^${src}$`, flags);

export const CURL_SH_RE = re(
  "(curl( -[A-Za-z]+)+|wget -qO-) ['\"]?https://[^\\s'\"|]+['\"]? \\| (sh|bash|zsh)( -s( -- [A-Za-z0-9 ._=-]+)?)?",
);
export const POWERSHELL_RE = re(
  "(irm|iwr|Invoke-RestMethod|Invoke-WebRequest)( -useb)? https://\\S+ \\| iex",
  "i",
);
const DOCKER_IMAGE_RE = /^[a-z0-9._/-]+(:[A-Za-z0-9._-]+)?$/;
const DOCKER_VALUE_FLAGS = new Set([
  "-p", "-v", "-e", "-w", "--name", "--env", "--publish", "--volume", "--network", "--platform",
]);

/** Returns the docker image for a `docker run|pull` line, or null. */
export function dockerImage(line) {
  if (!/^docker (run|pull) /.test(line)) return null;
  const tokens = line.split(" ");
  if (tokens.some((t) => t === "")) return null;
  let i = 2;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const t = tokens[i];
    if (!t.includes("=") && DOCKER_VALUE_FLAGS.has(t)) i += 2;
    else i += 1;
  }
  const image = tokens[i];
  if (!image || !DOCKER_IMAGE_RE.test(image)) return null;
  if (tokens.length - (i + 1) > 3) return null;
  return image;
}

/** §4.3 method table. Rank 1 is the simplest. */
export const METHODS = [
  { rank: 1, method: "brew", family: "brew", label: "Homebrew", platform: "macos-linux",
    re: re(`brew install (--cask )?${NAME}`) },
  { rank: 2, method: "npm-global", family: "node", label: "npm (global)", platform: "any",
    re: re(`(npm (i|install) (-g|--global)|pnpm (add|i|install) -g|yarn global add|bun (add|i|install) -g) ${NPM_TARGET}`) },
  { rank: 3, method: "npx", family: "node", label: "npx (no install)", platform: "any",
    re: re(`(npx( -y| --yes)?|pnpm dlx|bunx) ${NAME}(@[A-Za-z0-9._-]+)?${ARGS}`) },
  { rank: 4, method: "uv-tool", family: "python", label: "uv tool", platform: "any",
    re: re(`uv tool install (${NAME}|${GITURL})`) },
  { rank: 5, method: "uvx", family: "python", label: "uvx (no install)", platform: "any",
    re: re(`uvx ${NAME}${ARGS}`) },
  { rank: 6, method: "pipx", family: "python", label: "pipx", platform: "any",
    re: re(`pipx install (${NAME}|${GITURL})`) },
  { rank: 7, method: "pip", family: "python", label: "pip", platform: "any",
    re: re(`(pip3?|python3? -m pip|uv pip) install (-U |--upgrade )?(${NAME}(\\[[a-z0-9,_-]+\\])?|${GITURL})`) },
  { rank: 8, method: "cargo", family: "rust", label: "cargo", platform: "any",
    re: re(`cargo install (--locked )?(${NAME}|--git https://github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\\.git)?)( --locked)?`) },
  { rank: 9, method: "go", family: "go", label: "go install", platform: "any",
    re: re("go install [A-Za-z0-9._~/-]+@[A-Za-z0-9._-]+") },
  { rank: 10, method: "curl-sh", family: "shell", label: "install script", platform: "macos-linux",
    re: CURL_SH_RE },
  { rank: 11, method: "powershell", family: "shell", label: "PowerShell", platform: "windows",
    re: POWERSHELL_RE },
  { rank: 12, method: "docker", family: "docker", label: "Docker", platform: "any",
    test: (line) => dockerImage(line) !== null },
  // Manifest-only: README lines never produce this method.
  { rank: 13, method: "docker-build", family: "docker", label: "Docker build", platform: "any",
    manifestOnly: true,
    re: re("docker build -t [a-z0-9._-]+ https://github\\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.git#[A-Za-z0-9._/-]+") },
];

export const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.method, m]));
export const CLONE_META = { method: "clone", family: "git", label: "git clone", platform: "any" };
export const CONFIDENCE = ["readme", "manifest", "fallback"];
export const FAMILIES = ["node", "python", "rust", "go", "brew", "shell", "docker", "git"];
export const PLATFORMS = ["any", "macos-linux", "windows"];

const CLONE_RE = /^git clone --depth 1 https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\.git$/;
const SCRIPT_NOTE = "Pipes a remote script to your shell — read it first.";
const REPO_SCRIPT_NOTE = "Pipes a repo script to your shell — read it first.";
const FALLBACK_NOTE = "No one-line installer found — follow the README.";

/** All table methods whose shape matches the line (exact, anchored). */
export function matchMethods(line) {
  return METHODS.filter((m) => (m.test ? m.test(line) : m.re.test(line)));
}

const FORBIDDEN = [
  "`", "$(", "${", ";", "&", ">", "<", "\\", "{", "}",
  "sudo ", "eval ", " rm ", "rm -", "chmod", "mkfifo", "/dev/", "base64", "nc ",
  "...", "YOUR_", "your-", "<version>", "xxx",
];

/**
 * §4.5 — true only for a single, printable-ASCII, allowlisted one-liner.
 * `opts.allowClone` additionally accepts the canonical clone command.
 */
export function isSafeCommand(cmd, opts = {}) {
  if (typeof cmd !== "string") return false;
  if (cmd.length < 4 || cmd.length > 200) return false;
  if (!/^[\x20-\x7E]+$/.test(cmd)) return false;
  for (const bad of FORBIDDEN) if (cmd.includes(bad)) return false;
  const pipes = cmd.split("|").length - 1;
  if (pipes > 1) return false;
  if (pipes === 1 && !(CURL_SH_RE.test(cmd) || POWERSHELL_RE.test(cmd))) return false;
  if (/http:\/\//i.test(cmd)) return false;
  if (opts.allowClone && CLONE_RE.test(cmd)) return true;
  return matchMethods(cmd).length === 1;
}

export function cloneCommand(owner, repo) {
  return `git clone --depth 1 https://github.com/${owner}/${repo}.git`;
}

export function fallbackOption(clone) {
  return { ...CLONE_META, command: clone, confidence: "fallback", source: null, note: FALLBACK_NOTE };
}

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** §4.4 section score from a heading. -1 means "exclude". */
// The English patterns are exactly §4.4; the CJK equivalents are an addition
// because many trending repos write their README headings in Chinese/Japanese.
const EXCLUDE_RE = /contribut|develop|from source|build|test|uninstall|开发|開発|贡献|貢献|构建|編譯|编译|ビルド|测试|測試|テスト|卸载/i;
const INSTALL_RE = /install|安装|安裝|インストール|설치/i;
const QUICK_RE = /quick ?start|getting started|setup|get started|快速开始|快速上手|快速入门|クイックスタート|はじめに/i;
const USAGE_RE = /usage|run|try|使用|使い方|用法/i;

export function sectionScore(heading) {
  const h = heading || "";
  if (EXCLUDE_RE.test(h)) return -1;
  if (INSTALL_RE.test(h)) return 3;
  if (QUICK_RE.test(h)) return 2;
  if (USAGE_RE.test(h)) return 1;
  return 0;
}

/**
 * Score for a line given the heading stack (outermost first). The nearest
 * heading decides (§4.4). Refinements: a nearest heading that scores 0
 * inherits the closest positive ancestor score ("### Docker" under
 * "## Install"), and an excluded ancestor at level >= 2 ("## Development" >
 * "### Setup") excludes too. The level-1 title never excludes.
 */
export function stackScore(stack) {
  if (!stack.length) return 0;
  const own = sectionScore(stack[stack.length - 1].text);
  if (own < 0) return -1;
  for (let i = stack.length - 2; i >= 0; i--) {
    if (stack[i].level >= 2 && sectionScore(stack[i].text) < 0) return -1;
  }
  if (own > 0) return own;
  for (let i = stack.length - 2; i >= 0; i--) {
    const sc = sectionScore(stack[i].text);
    if (sc > 0) return sc;
  }
  return 0;
}

const stripVersion = (pkg) => {
  if (pkg.startsWith("@")) {
    const at = pkg.indexOf("@", 1);
    return at > 0 ? pkg.slice(0, at) : pkg;
  }
  const at = pkg.indexOf("@");
  return at > 0 ? pkg.slice(0, at) : pkg;
};
const lastSegment = (s) => s.split("/").filter(Boolean).pop() || s;
const packageBase = (pkg) => lastSegment(stripVersion(pkg).replace(/\[.*\]$/, ""));

/** The subject token T of a command (see relation check). */
export function subjectToken(method, cmd) {
  const toks = cmd.split(" ");
  const nonFlag = (from) => toks.slice(from).find((t) => !t.startsWith("-"));
  switch (method) {
    case "brew":
      return lastSegment(toks[toks.length - 1]);
    case "npm-global": {
      const t = toks[toks.length - 1];
      return t.startsWith("github:") ? t : packageBase(t);
    }
    case "npx": {
      const t = nonFlag(1);
      return t ? packageBase(t) : "";
    }
    case "uvx":
      return packageBase(toks[1] || "");
    case "uv-tool":
    case "pipx":
    case "pip": {
      const t = toks[toks.length - 1];
      return t.startsWith("git+") ? t : packageBase(t);
    }
    case "cargo": {
      const gi = toks.indexOf("--git");
      if (gi >= 0) return toks[gi + 1] || "";
      return packageBase(nonFlag(2) || "");
    }
    case "go":
      return (toks[2] || "").split("@")[0];
    case "docker":
    case "docker-build": {
      const img = method === "docker" ? dockerImage(cmd) || "" : toks[3] || "";
      return img.replace(/:[A-Za-z0-9._-]+$/, "");
    }
    case "curl-sh":
    case "powershell": {
      const m = cmd.match(/https:\/\/[^\s'"|]+/);
      return m ? m[0] : "";
    }
    default:
      return "";
  }
}

const hostOf = (u) => {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
};
const pathOf = (u) => {
  try { return new URL(u).pathname.toLowerCase(); } catch { return ""; }
};

/** Relation check: does the command install *this* repo (not a prerequisite)? */
export function isRelated(method, cmd, ctx) {
  const owner = String(ctx.owner).toLowerCase();
  const repo = String(ctx.repo).toLowerCase();
  const lc = cmd.toLowerCase();
  // Refinement: a docker image with no namespace ("magpie") is a locally built
  // image from an earlier `docker build -t magpie .` step (or an unrelated
  // official image), so `docker run … magpie` on its own would pull the wrong
  // thing. Only namespaced images (owner/img, ghcr.io/…) can be related.
  if (method === "docker" && !(dockerImage(cmd) || "").includes("/")) return false;
  // (a)
  if (lc.includes(`github.com/${owner}/${repo}`) || lc.includes(`${owner}/${repo}`)) return true;
  const T = subjectToken(method, cmd);
  const nT = norm(T);
  const nRepo = norm(repo);
  // (b)
  if (nT) {
    if (nT === nRepo) return true;
    for (const n of ctx.manifestNames || []) {
      if (!n) continue;
      if (nT === norm(n) || nT === norm(lastSegment(String(n)))) return true;
    }
  }
  // (c)
  if (nT && nRepo) {
    const [short, long] = nT.length <= nRepo.length ? [nT, nRepo] : [nRepo, nT];
    if (short.length >= 4 && long.includes(short)) return true;
  }
  // (d)
  if (method === "curl-sh" || method === "powershell") {
    const host = hostOf(T);
    if (host) {
      const ghHosts = ["github.com", "raw.githubusercontent.com", "objects.githubusercontent.com"];
      if (ghHosts.includes(host) && `${pathOf(T)}`.includes(`/${owner}/${repo}/`)) return true;
      const hpHost = ctx.homepage ? hostOf(ctx.homepage) : "";
      if (hpHost && (host === hpHost || host.endsWith(`.${hpHost}`) || hpHost.endsWith(`.${host}`))) return true;
      const nHost = norm(host);
      const nOwner = norm(owner);
      if (nRepo.length >= 4 && nHost.includes(nRepo)) return true;
      if (nOwner.length >= 4 && nHost.includes(nOwner)) return true;
    }
  }
  // (e)
  if (method === "docker") {
    const img = T.toLowerCase();
    const nImg = norm(img);
    const nOwner = norm(owner);
    if (nOwner.length >= 4 && nImg.includes(nOwner)) return true;
    if (nRepo.length >= 4 && nImg.includes(nRepo)) return true;
    if (img.startsWith(`ghcr.io/${owner}/`)) return true;
  }
  return false;
}

const SHELL_INFOS = new Set([
  "", "sh", "bash", "shell", "console", "zsh", "fish", "powershell", "pwsh", "ps1", "ps", "text", "terminal", "cmd",
]);
const CONSOLE_INFOS = new Set(["console", "terminal"]);

function cleanHeading(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function promptStrip(line, inConsole) {
  let s = line.trim();
  for (const p of ["PS> ", "$ ", "% ", "> "]) {
    if (s.startsWith(p)) return s.slice(p.length).trim();
  }
  if (inConsole && s.startsWith("# ")) return s.slice(2).trim();
  return s;
}

/**
 * §4.4 A — README candidates (confidence "readme"), ranked.
 * ctx: { owner, repo, homepage, readmeFile?, manifestNames? }
 */
export function extractReadmeCandidates(markdown, ctx) {
  if (typeof markdown !== "string" || !markdown) return [];
  const file = ctx.readmeFile || "README.md";
  const text = markdown.slice(0, 64 * 1024).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const raw = [];
  let stack = []; // heading stack: [{ level, text }]
  let fence = null; // { ch, len, allowed, console }
  let prev = "";
  let order = 0;

  const setHeading = (level, textRaw) => {
    const t = cleanHeading(textRaw);
    stack = stack.filter((h) => h.level < level);
    stack.push({ level, text: t });
  };
  const consider = (cmdLine, inConsole, fromFence) => {
    let s = promptStrip(cmdLine, inConsole);
    if (!s) return;
    if (s.startsWith("#") || s.startsWith("//")) return; // comment line
    if (fromFence) s = s.replace(/\s+#\s.*$/, "").trim(); // trailing shell comment
    const heading = stack.length ? stack[stack.length - 1].text : "";
    raw.push({ line: s, heading, score: stackScore(stack), order: order++ });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
        fence = null;
        prev = "";
        continue;
      }
      if (fence.allowed) consider(line, fence.console, true);
      continue;
    }
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (open) {
      const info = open[2].toLowerCase().replace(/^\{?\.?/, "").replace(/\}$/, "");
      fence = { ch: open[1][0], len: open[1].length, allowed: SHELL_INFOS.has(info), console: CONSOLE_INFOS.has(info) };
      prev = "";
      continue;
    }
    const atx = line.match(/^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/);
    if (atx && /^\s{0,3}#{1,6}(\s|$)/.test(line)) {
      setHeading(atx[1].length, atx[2] || "");
      prev = "";
      continue;
    }
    const html = line.match(/^\s*<h([1-6])\b[^>]*>(.*?)<\/h\1>\s*$/i);
    if (html) {
      setHeading(Number(html[1]), html[2]);
      prev = "";
      continue;
    }
    if (/^\s{0,3}(=+|-+)\s*$/.test(line) && prev.trim() && !/^\s*([-*+>|]|\d+\.)\s/.test(prev)) {
      setHeading(line.trim()[0] === "=" ? 1 : 2, prev);
      prev = "";
      continue;
    }
    // Inline code spans that are the whole command. Refinement: skip spans in
    // a sentence that warns against them ("Do not shorten it to `npx foo`").
    if (!NEGATION_RE.test(line)) {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) consider(m[1], false, false);
    }
    prev = line;
  }

  const scored = [];
  for (const c of raw) {
    if (c.score < 0) continue;
    if (!isSafeCommand(c.line)) continue;
    const matches = matchMethods(c.line);
    if (matches.length !== 1 || matches[0].manifestOnly) continue;
    const m = matches[0];
    if (!isRelated(m.method, c.line, ctx)) continue;
    scored.push({ m, c });
  }
  scored.sort((a, b) => b.c.score - a.c.score || a.m.rank - b.m.rank || a.c.order - b.c.order);
  const seen = new Set();
  const out = [];
  for (const { m, c } of scored) {
    // Dedupe by exact command (§4.4) and, for package installers, by
    // method + package so "npm i -g x", "npm install -g x@latest" and
    // "npm install --global x" collapse into the first-ranked one.
    const keys = [c.line];
    if (PACKAGE_METHODS.has(m.method)) keys.push(`${m.method}:${norm(subjectToken(m.method, c.line))}`);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({
      method: m.method,
      family: m.family,
      label: m.label,
      command: c.line,
      confidence: "readme",
      source: c.heading ? `${file} · ${c.heading}` : file,
      platform: m.platform,
      note: null,
    });
  }
  return out;
}

const NEGATION_RE = /\b(do not|don't|never|avoid|instead of|unrelated|deprecated|no longer|not published|is not|isn't)\b/i;
const PACKAGE_METHODS = new Set(["brew", "npm-global", "uv-tool", "pipx", "pip", "cargo", "go"]);

/**
 * Registry to consult for a README candidate whose relation to the repo rests
 * only on its package name (rules b/c), so a same-named package owned by
 * someone else is caught. Returns { registry: "npm"|"pypi", name } or null.
 */
export function registryTarget(cand, ctx) {
  const owner = String(ctx.owner).toLowerCase();
  const repo = String(ctx.repo).toLowerCase();
  if (cand.command.toLowerCase().includes(`${owner}/${repo}`)) return null; // rule (a)
  const toks = cand.command.split(" ");
  const pick = (from) => toks.slice(from).find((t) => !t.startsWith("-"));
  let registry = null;
  let pkg = null;
  if (cand.method === "npm-global") {
    registry = "npm";
    pkg = toks[toks.length - 1];
  } else if (cand.method === "npx") {
    registry = "npm";
    pkg = pick(1);
    if (toks[0] === "pnpm") pkg = pick(2);
  } else if (cand.method === "uvx") {
    registry = "pypi";
    pkg = toks[1];
  } else if (["pip", "pipx", "uv-tool"].includes(cand.method)) {
    registry = "pypi";
    pkg = toks[toks.length - 1];
  }
  if (!registry || !pkg || pkg.startsWith("git+") || pkg.startsWith("github:")) return null;
  const name = stripVersion(pkg).replace(/\[.*\]$/, "");
  return name ? { registry, name } : null;
}

/** Drop README candidates whose registry verdict is "bad" (missing or owned elsewhere). */
export function applyRegistryVerdicts(cands, verdicts, ctx) {
  return cands.filter((c) => {
    const t = registryTarget(c, ctx);
    return !t || verdicts[`${t.registry}:${t.name}`] !== "bad";
  });
}

// ---------- manifests ----------

function tomlSections(src) {
  const sections = {};
  let cur = "";
  sections[cur] = [];
  for (const line of String(src).replace(/\r\n?/g, "\n").split("\n")) {
    const h = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (h) {
      cur = h[1];
      if (!sections[cur]) sections[cur] = [];
      continue;
    }
    sections[cur].push(line);
  }
  return sections;
}
const tomlString = (lines, key) => {
  const rx = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`);
  for (const l of lines || []) {
    const m = l.match(rx);
    if (m) return m[1].trim();
  }
  return null;
};
const hasTomlTable = (src, name) =>
  new RegExp(`^\\s*\\[\\[?\\s*${name.replace(/\./g, "\\.")}\\s*\\]\\]?`, "m").test(String(src));

export function parsePackageJson(src) {
  if (typeof src !== "string") return null;
  try {
    const pkg = JSON.parse(src);
    return pkg && typeof pkg === "object" && !Array.isArray(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

/** Name of an npm CLI package worth verifying, else null. */
export function npmCliName(src) {
  const pkg = parsePackageJson(src);
  if (!pkg || pkg.private === true) return null;
  const hasBin = typeof pkg.bin === "string" ? pkg.bin.length > 0 : pkg.bin && typeof pkg.bin === "object" && Object.keys(pkg.bin).length > 0;
  return hasBin && typeof pkg.name === "string" && pkg.name ? pkg.name : null;
}

export function pyprojectInfo(src) {
  if (typeof src !== "string") return null;
  const s = tomlSections(src);
  const name = tomlString(s["project"], "name") || tomlString(s["tool.poetry"], "name");
  const scripts = hasTomlTable(src, "project.scripts") || hasTomlTable(src, "tool.poetry.scripts");
  return { name, scripts };
}

export function cargoInfo(src) {
  if (typeof src !== "string") return null;
  const s = tomlSections(src);
  return {
    name: tomlString(s["package"], "name"),
    hasPackage: hasTomlTable(src, "package"),
    hasWorkspace: hasTomlTable(src, "workspace"),
    hasBin: hasTomlTable(src, "bin"),
  };
}

export function goModule(src) {
  if (typeof src !== "string") return null;
  const m = src.match(/^\s*module\s+("?)([^\s"]+)\1\s*$/m);
  return m ? m[2] : null;
}

/** Names declared by manifests, used by the relation check (b). */
export function manifestNames(files) {
  const names = [];
  const pkg = parsePackageJson(files["package.json"]);
  if (pkg && typeof pkg.name === "string") names.push(pkg.name);
  const py = pyprojectInfo(files["pyproject.toml"]);
  if (py && py.name) names.push(py.name);
  const cargo = cargoInfo(files["Cargo.toml"]);
  if (cargo && cargo.name) names.push(cargo.name);
  return names;
}

const present = (v) => typeof v === "string";

const hasPrepare = (pkg) => Boolean(pkg && pkg.scripts && typeof pkg.scripts.prepare === "string" && pkg.scripts.prepare);

/** First bin path of a package.json (relative, without "./"), or null. */
export function npmBinPath(src) {
  const pkg = parsePackageJson(src);
  if (!pkg || !pkg.bin) return null;
  const p = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin).find((v) => typeof v === "string");
  return p ? p.replace(/^\.\//, "") : null;
}
export const npmHasPrepare = (src) => hasPrepare(parsePackageJson(src));

/**
 * Refinement: setup.py only means "pip installable" when it actually calls
 * setuptools/distutils setup(); some repos ship a setup.py that is a plain
 * one-click setup script.
 */
export function isSetuptoolsScript(src) {
  return present(src) && /\b(setuptools|distutils)\b/.test(src) && /\bsetup\s*\(/.test(src);
}

const LOCAL_SCRIPT_RE =
  /BASH_SOURCE|\$\{?0\}?(?![0-9])|dirname|requirements[\w.-]*\.txt|\bnpm (ci|install|i|run)\b(?!\s+(-g|--global))|\b(pnpm|yarn|bun) install\b|cargo (build|install --path)|\bgo (build|install) \.|\bmake( |$)|pip3? install (-e|-r|\.)|\s\.\/(cmd|src|app|bin|scripts|packages)\b/m;
const FETCH_RE = /\b(curl|wget|git clone)\b/;

/**
 * Refinement: `curl …/install.sh | sh` only works for a self-contained
 * bootstrapper. A script that cd's to its own directory or builds files from
 * the checkout (requirements.txt, ./cmd, npm install, make) needs a clone.
 */
export function isStandaloneInstaller(src) {
  return present(src) && !LOCAL_SCRIPT_RE.test(src) && FETCH_RE.test(src);
}

/**
 * §4.4 B — manifest candidates (confidence "manifest"), in priority order.
 * files: { "package.json": string|null, ... }  ctx: { owner, repo, defaultBranch, npmVerified, pypiVerified }
 */
export function manifestCandidates(files, ctx) {
  const { owner, repo } = ctx;
  const branch = ctx.defaultBranch || "main";
  const gh = `https://github.com/${owner}/${repo}`;
  const out = [];
  const add = (method, command, source, note = null) => {
    if (!isSafeCommand(command)) return;
    const matches = matchMethods(command);
    if (matches.length !== 1 || matches[0].method !== method) return;
    const m = METHOD_BY_ID[method];
    out.push({ method, family: m.family, label: m.label, command, confidence: "manifest", source, platform: m.platform, note });
  };

  // 1. package.json
  const pkg = parsePackageJson(files["package.json"]);
  if (pkg && pkg.private !== true) {
    const name = npmCliName(files["package.json"]);
    if (name) {
      if (ctx.npmVerified) add("npm-global", `npm install -g ${name}`, "package.json");
      else if (!(ctx.npmBinPresent === false && !hasPrepare(pkg))) {
        // Refinement: a git install of a CLI whose bin file is not committed
        // (e.g. dist/cli.js) and has no "prepare" build would be broken.
        add("npm-global", `npm install -g github:${owner}/${repo}`, "package.json", "Installs straight from GitHub (not published to npm).");
      }
    }
  }
  // 2. pyproject.toml (refinement: only a real package table counts; a
  // pyproject that just configures tools like ruff is not installable)
  const pyRaw = pyprojectInfo(files["pyproject.toml"]);
  const py = pyRaw && pyRaw.name ? pyRaw : null;
  if (py) {
    const target = py.name && ctx.pypiVerified ? py.name : `git+${gh}.git`;
    if (py.scripts) {
      add("pipx", `pipx install ${target}`, "pyproject.toml");
      add("uv-tool", `uv tool install ${target}`, "pyproject.toml");
    } else {
      add("pip", `pip install ${target}`, "pyproject.toml");
    }
  } else if (isSetuptoolsScript(files["setup.py"])) {
    // 3. setup.py
    add("pip", `pip install git+${gh}.git`, "setup.py");
  }
  // 4. Cargo.toml
  const cargo = cargoInfo(files["Cargo.toml"]);
  if (cargo && !(cargo.hasWorkspace && !cargo.hasPackage)) {
    if (cargo.hasBin || present(files["src/main.rs"])) add("cargo", `cargo install --git ${gh}`, "Cargo.toml");
  }
  // 5. go.mod
  const mod = goModule(files["go.mod"]);
  if (mod && present(files["main.go"])) add("go", `go install ${mod}@latest`, "go.mod");
  // 6. install.sh
  if (isStandaloneInstaller(files["install.sh"])) {
    add("curl-sh", `curl -fsSL https://raw.githubusercontent.com/${owner}/${repo}/${branch}/install.sh | sh`, "install.sh", REPO_SCRIPT_NOTE);
  }
  // 7. Dockerfile
  if (present(files["Dockerfile"]) && norm(repo)) {
    add("docker-build", `docker build -t ${norm(repo)} ${gh}.git#${branch}`, "Dockerfile");
  }
  return out;
}

const publicOption = (o) => ({
  method: o.method,
  family: o.family,
  label: o.label,
  command: o.command,
  confidence: o.confidence,
  source: o.source ?? null,
  platform: o.platform,
  note: o.note ?? null,
});

/** §4.4 C — primary, up to 3 alternates, and the clone command. */
export function assembleInstall(readmeCands, manifestCands, ctx) {
  const clone = cloneCommand(ctx.owner, ctx.repo);
  const all = [...(readmeCands || []), ...(manifestCands || [])].map(publicOption);
  for (const o of all) {
    if ((o.method === "curl-sh" || o.method === "powershell") && !o.note) o.note = SCRIPT_NOTE;
  }
  const primary = all[0] || fallbackOption(clone);
  const seen = new Set([primary.command]);
  const alternates = [];
  for (const o of all.slice(1)) {
    if (seen.has(o.command)) continue;
    seen.add(o.command);
    alternates.push(o);
    if (alternates.length === 3) break;
  }
  return { primary, alternates, clone };
}
