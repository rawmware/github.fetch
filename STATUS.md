# Where things stand (paused 2026-10-03)

## The goal
1. **github.fetch** makes at least 60 commits a day on its own, using GitHub Actions on GitHub's servers. It needs no computer, phone or VM.
2. Each commit does real work: it finds a brand-new GitHub repo and writes a guide for running it **in a web browser** (StackBlitz, Codespaces, Colab, Binder, raw.githack, fork), plus a "make it mine" AI prompt.
3. The guides show up live on **aictuallyhelp.com/repos.html**.

## Done in rawmware/github.fetch (branch `claude/amazing-thompson-5bvuoy`, not merged)

| File | What it does |
|---|---|
| `scripts/lib/guide.mjs` | Pure logic: spam filter, stack detection (Node/Vite/Next, static, Python/Streamlit/GPU, notebooks, Rust, Go, Docker, native, docs), launch links, license notes, remix prompt, markdown guide, commit pacing |
| `scripts/lib/github.mjs` | GitHub search, root file listing (with a raw-file fallback), reads package.json, requirements.txt and pyproject.toml |
| `scripts/pulse.mjs` | Works out how many commits are owed today, then writes `guides/<owner>/<repo>.md`, `data/feed.json` and the README "Latest finds" block, **one commit per repo** (`scout: …`). If there are no new repos, it refreshes star counts instead |
| `.github/workflows/pulse.yml` | Runs every 15 minutes (`4,19,34,49 * * * *`) and on manual dispatch. Commits as `<owner id>+<owner>@users.noreply.github.com` so they count as your contributions. `DAILY_TARGET` defaults to 64 and never goes below 60 |
| `scripts/test.mjs` | 12 tests, all passing (`npm test`) |
| `README.md`, `package.json`, `scripts/fixtures/seed-search.json` | Docs, npm scripts, and 30 real new repos for offline testing |

**Verified:**
- A real run against 27 live repos detected their stacks correctly.
- In a scratch git repo, the first run made 20 commits (the per-run catch-up cap), all authored with the no-reply email.
- The second run counted those 20 correctly.
- Simulating a day where a third of the scheduled runs are skipped still gives at least 60 commits.

## In progress in rawmware/aictuallyhelp (same branch name, not merged)
- **Done:**
  - `repos.html`: stats, search, level filters, cards with an "Open in …" button, more launch links, steps, license, and a copy "make it mine" prompt.
  - `assets/repos.js`: reads `https://raw.githubusercontent.com/rawmware/github.fetch/main/data/feed.json` live, so the page needs no redeploy.
  - The fresh repos styles appended to `assets/site.css`.
- **Not done:**
  - Add a `Fresh repos` link to the nav and footer of every other page.
  - Add `repos.html` to `sitemap.xml` and the README table.
  - Check the page in a browser (Playwright is available).

## What's left to go live
1. Finish the aictuallyhelp bullets above.
2. Merge github.fetch's branch into `main`. The schedule only runs on `main`.
3. Merge aictuallyhelp's branch into `main`. Vercel deploys it.
4. In github.fetch, go to **Actions → pulse → Run workflow** once to start it. The first run catches up by up to 20 commits.

## Notes
- **iPhone:** you don't need it to make contributions. To watch or trigger runs, use the GitHub app or Safari: github.com/rawmware/github.fetch/actions → pulse → Run workflow.
- **Timezone:** the pacing uses UTC days. Commits are spread across the whole day, so any local-time day should still get about 60 or more.
- `BUILD.md` is the older Day 5 spec (one-line installs). It was kept, but this design replaces it.
