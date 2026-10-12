# github.fetch
An automated GitHub discovery and sync tool. Find, update, and fork public open-source repositories faster. Spend less time searching and more time shipping by effortlessly building on top of great foundations.

**Live application:** https://rawmware.com/365-days/projects/day-005

Every 15 minutes a GitHub Actions job looks for brand-new repositories people are starring, works out how to run each one **in a web browser** (no download, no install), and writes a guide for it. Every guide is its own commit, at least 60 a day, around the clock, with no computer of yours switched on.

## What you get for each repo

- **What it is**: Vite app, Python Streamlit app, static site, notebook, Rust project, awesome-list…
- **How hard it is to run in a browser**:
  - *instant*: runs in a tab with no account (StackBlitz, or the live site straight from GitHub)
  - *free account*: Codespaces, Colab, CodeSandbox
  - *heavy*: needs a GPU or a phone/desktop platform
  - *read*: it's a list or guide, so there's nothing to run
- **One-click launch links**: StackBlitz, CodeSandbox, GitHub Codespaces, Google Colab, Binder, github.dev, Fork.
- **The commands to type**, and the same steps for running it on your own computer.
- **A "make it yours" prompt** to paste into ChatGPT, Claude or Gemini, which walks you through forking it, changing it and hosting your own version.
- **What the license lets you do.**

Guides are in [`guides/`](guides/). The newest 500 are in [`data/feed.json`](data/feed.json), which is what the website reads.

## Latest finds

<!-- latest:start -->
_584 guides written so far · last update 2026-10-12 09:40 UTC_

| Repo | What it is | In the browser | |
|---|---|---|---|
| [Teraflopping/xrevive](https://github.com/Teraflopping/xrevive) | List / guide / docs | Nothing to run: read it in the browser | [guide](guides/teraflopping/xrevive.md) |
| [zhutoumeme/mcd-git](https://github.com/zhutoumeme/mcd-git) | Python project | Runs in the browser with a free account | [guide](guides/zhutoumeme/mcd-git.md) |
| [updatesanninconduit/WUWA-Menu-Undetected](https://github.com/updatesanninconduit/WUWA-Menu-Undetected) | List / guide / docs | Nothing to run: read it in the browser | [guide](guides/updatesanninconduit/wuwa-menu-undetected.md) |
| [AFAlimru/fastly-hosts-adjust](https://github.com/AFAlimru/fastly-hosts-adjust) | Python project | Runs in the browser with a free account | [guide](guides/afalimru/fastly-hosts-adjust.md) |
| [artouc/stop-describing-ui](https://github.com/artouc/stop-describing-ui) | List / guide / docs | Nothing to run: read it in the browser | [guide](guides/artouc/stop-describing-ui.md) |
| [AI-BizOS/cross-harness](https://github.com/AI-BizOS/cross-harness) | Node command-line tool | Runs in a browser tab, no account needed | [guide](guides/ai-bizos/cross-harness.md) |
| [onehumanbeing/esp32-iphone-agent](https://github.com/onehumanbeing/esp32-iphone-agent) | Python project | Runs in the browser with a free account | [guide](guides/onehumanbeing/esp32-iphone-agent.md) |
| [chekusu/yobiru](https://github.com/chekusu/yobiru) | Python project | Runs in the browser with a free account | [guide](guides/chekusu/yobiru.md) |
| [HRuiCcc/RuiC-oc-ferry](https://github.com/HRuiCcc/RuiC-oc-ferry) | JavaScript project | Runs in the browser with a free account | [guide](guides/hruiccc/ruic-oc-ferry.md) |
| [jhaizhou-ops/d2r-mobile](https://github.com/jhaizhou-ops/d2r-mobile) | C project | Needs a real machine (or a GPU) to run | [guide](guides/jhaizhou-ops/d2r-mobile.md) |
| [zhuyansen/new-term-radar](https://github.com/zhuyansen/new-term-radar) | Python project | Runs in the browser with a free account | [guide](guides/zhuyansen/new-term-radar.md) |
| [shaongitbd/doory](https://github.com/shaongitbd/doory) | Docker app | Runs in the browser with a free account | [guide](guides/shaongitbd/doory.md) |
<!-- latest:end -->

## How it works

```
cron (every 15 min) → scripts/pulse.mjs
  how many commits are owed today?    (paced to DAILY_TARGET, catches up after skipped runs)
  GitHub search: repos created in the last 2 / 7 / 30 days, sorted by stars, spam filtered
  for each new repo:
    list its root files, read package.json / requirements.txt / pyproject.toml
    detect the stack → pick browser launchers → write guides/<owner>/<repo>.md + data/feed.json
    git commit "scout: owner/repo — …"
  if there are no new repos left: re-check the star count of the stalest guide and commit that
git push
```

The pacing is `due = ceil(target × (minutes into the UTC day + 90) / 1440)`, at most 20 commits per run. Missed runs are made up on the next one, and the day's target is reached about 90 minutes before midnight UTC.

## Settings (repo → Settings → Secrets and variables → Actions → Variables)

| Variable | Default | |
|---|---|---|
| `DAILY_TARGET` | `64` | Commits per UTC day. Values under 60 are raised to 60. |
| `CONTRIB_EMAIL` | `<owner id>+<owner>@users.noreply.github.com` | Author email. Must be an email on your GitHub account, or the commits won't count as your contributions. |
| `CONTRIB_NAME` | repo owner login | Author name. |

Run it on demand: **Actions → pulse → Run workflow**. Set *commits* to a number to make that many guide commits right away. This works from Safari on a phone too.

## Why the commits count on your contribution graph

GitHub counts a commit when all of these are true:

1. Its author email belongs to your account. The workflow uses your `users.noreply.github.com` address by default.
2. It's on the default branch (`main`). Scheduled workflows only run there anyway.
3. The repo isn't a fork.

Scheduled workflows also stop after 60 days without repo activity. This one commits every 15 minutes, so it keeps itself alive.

## Run it locally

```sh
npm test                         # unit tests, no network
npm run try                      # 3 guides from the bundled seed file, no git commits
GITHUB_TOKEN=… node scripts/pulse.mjs --commits 5   # 5 real guide commits
```

Node 20+ and no dependencies.

## The application

The portable static frontend is in [`web/`](web/). It reads this repository's live feed and public commit history, so its 60-a-day meter is evidence rather than a hard-coded claim. Search, browser-access filters, launch links, setup commands, licensing context and make-it-yours prompts all run without a backend or API key.

`vercel.json` serves `web/` as the root when this repository gets its own Vercel project. Until then, the same files are published inside RawmWare's Day 5 route.

`BUILD.md` is the earlier Day 5 spec (install one-liners). This version replaces it with browser-first guides.
