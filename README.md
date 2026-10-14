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
_704 guides written so far · last update 2026-10-14 10:32 UTC_

| Repo | What it is | In the browser | |
|---|---|---|---|
| [cdcailf/cjkfold](https://github.com/cdcailf/cjkfold) | Python project | Runs in the browser with a free account | [guide](guides/cdcailf/cjkfold.md) |
| [mosheng1/QcClip](https://github.com/mosheng1/QcClip) | Rust project | Runs in the browser with a free account | [guide](guides/mosheng1/qcclip.md) |
| [Yukinodot/XiYuan-QRNG](https://github.com/Yukinodot/XiYuan-QRNG) | Python project | Runs in the browser with a free account | [guide](guides/yukinodot/xiyuan-qrng.md) |
| [deeeeone/gitdrive](https://github.com/deeeeone/gitdrive) | Swift project | Needs a real machine (or a GPU) to run | [guide](guides/deeeeone/gitdrive.md) |
| [soniciso1/ps5-hv-writeups](https://github.com/soniciso1/ps5-hv-writeups) | List / guide / docs | Nothing to run: read it in the browser | [guide](guides/soniciso1/ps5-hv-writeups.md) |
| [gabrielgreco1/LGwebOS-menubar](https://github.com/gabrielgreco1/LGwebOS-menubar) | Swift project | Needs a real machine (or a GPU) to run | [guide](guides/gabrielgreco1/lgwebos-menubar.md) |
| [derekross/omarchy-mobile](https://github.com/derekross/omarchy-mobile) | QML project | Runs in the browser with a free account | [guide](guides/derekross/omarchy-mobile.md) |
| [NB-Corp/gpt-with-taste](https://github.com/NB-Corp/gpt-with-taste) | JavaScript project | Runs in the browser with a free account | [guide](guides/nb-corp/gpt-with-taste.md) |
| [Zfinix/eleven](https://github.com/Zfinix/eleven) | Rust project | Runs in the browser with a free account | [guide](guides/zfinix/eleven.md) |
| [josefchen/muster](https://github.com/josefchen/muster) | Swift project | Needs a real machine (or a GPU) to run | [guide](guides/josefchen/muster.md) |
| [outcrawlai/scout](https://github.com/outcrawlai/scout) | JavaScript project | Runs in the browser with a free account | [guide](guides/outcrawlai/scout.md) |
| [solana-classic/solana-classic](https://github.com/solana-classic/solana-classic) | JavaScript project | Runs in the browser with a free account | [guide](guides/solana-classic/solana-classic.md) |
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
