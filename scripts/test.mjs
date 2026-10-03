import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGuide, commitsOwed, detectStack, guideMarkdown, isSpam, launchLinks, licenseNote, normalizeItem, pythonDeps } from "./lib/guide.mjs";

const repo = (over = {}) => normalizeItem({
  full_name: "acme/rocket", name: "rocket", description: "A rocket that does useful things", language: "TypeScript",
  stargazers_count: 120, forks_count: 4, topics: [], license: { spdx_id: "MIT" }, created_at: "2026-10-01T00:00:00Z",
  default_branch: "main", owner: { login: "acme", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" }, ...over,
});

test("normalizeItem keeps good repos and drops junk", () => {
  const r = repo();
  assert.equal(r.fullName, "acme/rocket");
  assert.equal(r.license, "MIT");
  assert.equal(r.url, "https://github.com/acme/rocket");
  assert.equal(repo({ fork: true }), null);
  assert.equal(repo({ description: "short" }), null);
  assert.equal(repo({ description: "Free Robux generator 2026 working" }), null);
  assert.equal(repo({ license: { spdx_id: "NOASSERTION" } }).license, null);
  assert.ok(isSpam({ description: "ok", topics: ["aimbot"] }));
});

test("Vite app runs instantly on StackBlitz", () => {
  const s = detectStack(repo(), { files: ["package.json", "package-lock.json"], packageJson: JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "5", react: "18" } }) });
  assert.equal(s.kind, "node");
  assert.equal(s.level, "instant");
  assert.equal(s.run, "npm run dev");
  assert.equal(s.label, "Vite app");
  const links = launchLinks(repo(), s);
  assert.equal(links[0].id, "stackblitz");
  assert.equal(links[0].url, "https://stackblitz.com/github/acme/rocket");
});

test("pnpm + native deps fall back to Codespaces", () => {
  const s = detectStack(repo(), { files: ["package.json", "pnpm-lock.yaml"], packageJson: JSON.stringify({ scripts: { dev: "x" }, dependencies: { electron: "30" } }) });
  assert.equal(s.level, "account");
  assert.equal(s.install, "pnpm install");
  assert.equal(s.run, "pnpm dev");
  assert.match(s.notes.join(" "), /electron/);
});

test("monorepo picks dev:web and says so", () => {
  const s = detectStack(repo(), { files: ["package.json"], packageJson: JSON.stringify({ workspaces: ["apps/*"], scripts: { "dev:api": "x", "dev:web": "y" } }) });
  assert.equal(s.run, "npm run dev:web");
  assert.equal(s.level, "account");
  assert.match(s.notes.join(" "), /monorepo/);
});

test("static site gets a live link", () => {
  const s = detectStack(repo({ language: "HTML" }), { files: ["index.html", "style.css"] });
  assert.equal(s.kind, "static");
  assert.equal(s.level, "instant");
  assert.equal(launchLinks(repo(), s)[0].url, "https://raw.githack.com/acme/rocket/main/index.html");
});

test("python: streamlit app, GPU libs, notebooks", () => {
  const st = detectStack(repo({ language: "Python" }), { files: ["app.py", "requirements.txt"], requirements: "streamlit==1.3\npandas>=2\n" });
  assert.equal(st.run, "streamlit run app.py");
  assert.equal(st.install, "pip install -r requirements.txt");
  assert.equal(st.level, "account");
  const gpu = detectStack(repo({ language: "Python" }), { files: ["pyproject.toml"], pyproject: '[project]\ndependencies = [\n  "torch>=2",\n  "numpy",\n]\n' });
  assert.equal(gpu.level, "heavy");
  const nb = detectStack(repo({ language: "Jupyter Notebook" }), { files: ["demo.ipynb"] });
  assert.equal(nb.kind, "notebook");
  assert.equal(launchLinks(repo(), nb)[0].url, "https://colab.research.google.com/github/acme/rocket/blob/main/demo.ipynb");
});

test("pythonDeps parses requirements and pyproject lists", () => {
  assert.deepEqual([...pythonDeps("Flask==2\n# c\ngradio[oauth]>=4\nnumpy\n")].sort(), ["flask", "gradio", "numpy"]);
});

test("lists and native apps", () => {
  assert.equal(detectStack(repo({ language: null }), { files: ["README.md", "LICENSE"] }).level, "read");
  assert.equal(detectStack(repo({ language: "Swift" }), { files: ["Package.swift"] }).level, "heavy");
});

test("license notes", () => {
  assert.match(licenseNote(null), /permission/);
  assert.match(licenseNote("MIT"), /use, change and share/);
  assert.match(licenseNote("GPL-3.0"), /same license/);
});

test("guide + markdown", () => {
  const g = buildGuide(repo(), { files: ["package.json"], packageJson: '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"5"}}' }, "2026-10-03T12:00:00.000Z");
  assert.equal(g.best, "stackblitz");
  assert.match(g.local, /^git clone --depth 1 https:\/\/github.com\/acme\/rocket.git\ncd rocket\nnpm install\nnpm run dev$/);
  assert.match(g.prompt, /https:\/\/github.com\/acme\/rocket/);
  const md = guideMarkdown(g);
  assert.match(md, /^# acme\/rocket/);
  assert.match(md, /stackblitz\.com\/github\/acme\/rocket/);
  for (const l of g.launch) assert.ok(l.url.startsWith("https://"), l.url);
});

test("commit pacing hits at least 60 a day and self-heals", () => {
  const at = (h, m = 0) => `2026-10-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  assert.equal(commitsOwed({ now: at(0, 4), doneToday: 0, target: 64 }), 5);
  assert.equal(commitsOwed({ now: at(12), doneToday: 0, target: 64 }), 20); // missed runs: capped catch-up
  assert.equal(commitsOwed({ now: at(23, 49), doneToday: 64, target: 64 }), 0);
  assert.equal(commitsOwed({ now: at(23, 49), doneToday: 50, target: 64 }), 14);
  // Simulate a full day of 15-minute runs where a third of them never fire.
  let done = 0;
  for (let t = 4; t < 1440; t += 15) {
    if (t % 45 === 19) continue;
    done += commitsOwed({ now: `2026-10-03T${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}:00Z`, doneToday: done, target: 64 });
  }
  assert.ok(done >= 60, `only ${done}`);
});

test("seed fixture normalizes", () => {
  const seed = JSON.parse(readFileSync(new URL("./fixtures/seed-search.json", import.meta.url), "utf8"));
  const ok = seed.items.map(normalizeItem).filter(Boolean);
  assert.ok(ok.length >= 20, `${ok.length}`);
});
