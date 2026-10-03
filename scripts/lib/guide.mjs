// Pure functions: turn what we know about a repo into a "run it in your browser" guide.
// No network, no fs — everything here is unit-tested in scripts/test.mjs.

export const LEVELS = {
  instant: "Runs in a browser tab, no account needed",
  account: "Runs in the browser with a free account",
  heavy: "Needs a real machine (or a GPU) to run",
  read: "Nothing to run: read it in the browser",
};

const SPAM = /\b(cheats?|hack(s|ed)?|crack(ed)?|keygen|aimbot|wallhack|mod ?menu|robux|v-?bucks|free (download|premium)|generator 202\d|unlock(er)?|spoofer|injector|airdrop|casino)\b/i;
const SPAM_TOPICS = new Set(["cheat", "hack", "crack", "keygen", "aimbot", "spoofer"]);

const WEB_FRAMEWORKS = [
  ["next", "Next.js"], ["nuxt", "Nuxt"], ["@sveltejs/kit", "SvelteKit"], ["astro", "Astro"],
  ["@remix-run/react", "Remix"], ["@angular/core", "Angular"], ["vite", "Vite"],
  ["react-scripts", "Create React App"], ["@vue/cli-service", "Vue CLI"], ["gatsby", "Gatsby"],
  ["svelte", "Svelte"], ["vue", "Vue"], ["react", "React"], ["solid-js", "Solid"], ["preact", "Preact"],
  ["express", "Express"], ["fastify", "Fastify"], ["hono", "Hono"],
];
// Packages that WebContainers (StackBlitz) can't run, or that need a desktop / native toolchain.
const NODE_NATIVE = ["electron", "better-sqlite3", "sqlite3", "puppeteer", "playwright", "sharp", "canvas", "node-pty", "@tauri-apps/api", "react-native", "expo", "bcrypt"];
const PY_WEB_UI = [["streamlit", "Streamlit"], ["gradio", "Gradio"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["django", "Django"], ["dash", "Dash"], ["panel", "Panel"], ["nicegui", "NiceGUI"]];
const PY_GPU = ["torch", "tensorflow", "jax", "vllm", "transformers", "diffusers", "xformers", "bitsandbytes", "flash-attn", "accelerate", "cuda", "triton"];
const NATIVE_LANGS = new Set(["Swift", "Objective-C", "Kotlin", "C#", "C++", "C", "Dart", "Java", "Zig", "Assembly", "Verilog", "CUDA"]);

export function isSpam(item) {
  const desc = String(item.description || "");
  if (SPAM.test(desc) || SPAM.test(String(item.name || ""))) return true;
  return (item.topics || []).some((t) => SPAM_TOPICS.has(String(t).toLowerCase()));
}

/** GitHub search item → the compact repo record we keep. Returns null if we should skip it. */
export function normalizeItem(item) {
  if (!item || item.fork || item.archived || item.disabled) return null;
  const description = String(item.description || "").replace(/\s+/g, " ").trim();
  if (description.length < 10 || isSpam(item)) return null;
  const fullName = String(item.full_name || "");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(fullName)) return null;
  const [owner, name] = fullName.split("/");
  const lic = item.license && typeof item.license === "object" ? item.license.spdx_id : item.license;
  const homepage = /^https?:\/\//.test(item.homepage || "") ? item.homepage : null;
  return {
    fullName, owner, name,
    url: `https://github.com/${fullName}`,
    avatar: item.owner?.avatar_url || `https://avatars.githubusercontent.com/${owner}`,
    description: description.slice(0, 280),
    language: item.language || null,
    topics: (item.topics || []).slice(0, 8),
    license: lic && lic !== "NOASSERTION" ? lic : null,
    stars: item.stargazers_count | 0,
    forks: item.forks_count | 0,
    createdAt: item.created_at,
    branch: item.default_branch || "main",
    homepage,
  };
}

function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
const has = (files, ...names) => names.some((n) => files.has(n.toLowerCase()));

/** Lower-cased requirement names from requirements.txt / pyproject.toml text. */
export function pythonDeps(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/^[\s"']*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~;"',]|$)/gm)) {
    out.add(m[1].toLowerCase().replace(/_/g, "-"));
  }
  return out;
}

/**
 * Work out what the repo is and how to run it in a browser.
 * @param repo normalized repo (normalizeItem)
 * @param probe { files: string[] (root file names), packageJson?: string, requirements?: string, pyproject?: string }
 */
export function detectStack(repo, probe = {}) {
  const files = new Set((probe.files || []).map((f) => f.toLowerCase()));
  const notebooks = (probe.files || []).filter((f) => /\.ipynb$/i.test(f));
  const notes = [];
  const pkg = probe.packageJson ? parseJSON(probe.packageJson) : null;

  if (pkg && typeof pkg === "object") {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const frameworks = WEB_FRAMEWORKS.filter(([d]) => d in deps).map(([, label]) => label);
    const scripts = pkg.scripts || {};
    const native = NODE_NATIVE.filter((d) => d in deps);
    const pm = has(files, "pnpm-lock.yaml", "pnpm-workspace.yaml") ? "pnpm" : has(files, "yarn.lock") ? "yarn" : "npm";
    const install = pm === "yarn" ? "yarn" : `${pm} install`;
    const runScript = ["dev", "start", "serve", "preview"].find((s) => scripts[s])
      || Object.keys(scripts).find((s) => /^(dev|start)[:-](web|app|client|frontend|ui|site)$/.test(s));
    const run = !runScript ? null : runScript === "start" ? `${pm} start` : pm === "npm" ? `npm run ${runScript}` : `${pm} ${runScript}`;
    const monorepo = Boolean(pkg.workspaces) || has(files, "pnpm-workspace.yaml", "turbo.json", "lerna.json", "nx.json");
    if (monorepo) notes.push("It's a monorepo (several packages in one). Check the README for which folder to start in.");
    if (native.length) notes.push(`Uses ${native.slice(0, 3).join(", ")}, which can't run inside a browser tab. Use Codespaces instead.`);
    if (has(files, "bun.lockb", "bun.lock")) notes.push("Made with Bun. If npm gives trouble, open it in Codespaces and use bun.");
    const isWeb = frameworks.length > 0 || Boolean(runScript);
    const instant = isWeb && !native.length && !monorepo;
    return {
      kind: "node", label: frameworks.length ? `${frameworks[0]} app` : pkg.bin ? "Node command-line tool" : "JavaScript project",
      frameworks: frameworks.slice(0, 3),
      level: instant ? "instant" : "account",
      install, run: run || (pkg.bin ? `node ${typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0]}` : null),
      notes, notebooks,
    };
  }

  if (notebooks.length) {
    return { kind: "notebook", label: "Jupyter notebook", frameworks: [], level: "account",
      install: has(files, "requirements.txt") ? "pip install -r requirements.txt" : null,
      run: null, notes, notebooks };
  }

  const isPython = has(files, "requirements.txt", "pyproject.toml", "setup.py", "pipfile", "environment.yml") || repo.language === "Python" || repo.language === "Jupyter Notebook";
  if (isPython) {
    const deps = new Set([...pythonDeps(probe.requirements), ...pythonDeps(probe.pyproject)]);
    const ui = PY_WEB_UI.find(([d]) => deps.has(d));
    const gpu = PY_GPU.some((d) => deps.has(d));
    if (gpu) notes.push("Uses heavy AI libraries (like PyTorch). Google Colab gives you a free GPU — Codespaces won't have one.");
    const entry = ["app.py", "main.py", "run.py", "server.py", "demo.py", "webui.py", "cli.py"].find((f) => files.has(f));
    let run = null;
    if (ui && ui[0] === "streamlit" && entry) run = `streamlit run ${entry}`;
    else if (entry) run = `python ${entry}`;
    const install = has(files, "requirements.txt") ? "pip install -r requirements.txt"
      : has(files, "pyproject.toml", "setup.py") ? "pip install -e ." : null;
    if (ui) notes.push(`Has a ${ui[1]} web interface: when it starts, Codespaces pops up a link to open it in a new tab.`);
    return { kind: "python", label: ui ? `Python ${ui[1]} app` : "Python project", frameworks: ui ? [ui[1]] : [],
      level: gpu ? "heavy" : "account", install, run, notes, notebooks };
  }

  if (has(files, "index.html")) {
    return { kind: "static", label: "Static website (HTML/CSS/JS)", frameworks: [], level: "instant",
      install: null, run: "npx serve .", notes, notebooks };
  }

  if (has(files, "cargo.toml")) return { kind: "rust", label: "Rust project", frameworks: [], level: "account", install: "cargo build --release", run: "cargo run", notes, notebooks };
  if (has(files, "go.mod")) return { kind: "go", label: "Go project", frameworks: [], level: "account", install: "go build ./...", run: has(files, "main.go") ? "go run ." : null, notes, notebooks };
  if (has(files, "dockerfile", "docker-compose.yml", "compose.yaml", "docker-compose.yaml")) {
    return { kind: "docker", label: "Docker app", frameworks: [], level: "account", install: null,
      run: has(files, "docker-compose.yml", "compose.yaml", "docker-compose.yaml") ? "docker compose up" : "docker build -t app . && docker run -p 8080:8080 app", notes, notebooks };
  }
  if (repo.language && NATIVE_LANGS.has(repo.language)) {
    notes.push(`${repo.language} usually means a desktop, phone or system app. You can read and edit it in the browser, but running it needs that platform.`);
    return { kind: "native", label: `${repo.language} project`, frameworks: [], level: "heavy", install: null, run: null, notes, notebooks };
  }
  const codeLike = (probe.files || []).some((f) => /\.(js|ts|py|rb|php|go|rs|java|c|cpp|cs|sh|lua|swift|kt)$/i.test(f));
  if (!repo.language && !codeLike) {
    return { kind: "docs", label: "List / guide / docs", frameworks: [], level: "read", install: null, run: null, notes, notebooks };
  }
  return { kind: "other", label: repo.language ? `${repo.language} project` : "Code project", frameworks: [], level: "account", install: null, run: null, notes, notebooks };
}

/** Browser launch links, best first. Every URL only ever points at the repo itself. */
export function launchLinks(repo, stack) {
  const fn = repo.fullName, br = encodeURIComponent(repo.branch);
  const L = [];
  const add = (id, label, url, needs, note) => L.push({ id, label, url, needs, note });
  if (stack.kind === "static") add("live", "Open it live", `https://raw.githack.com/${fn}/${br}/index.html`, "nothing", "Opens the site straight from GitHub. Some sites need a build step first, so if it looks broken, use StackBlitz.");
  if (stack.kind === "node" || stack.kind === "static") {
    add("stackblitz", "StackBlitz", `https://stackblitz.com/github/${fn}`, "nothing", stack.kind === "node" ? `Runs Node.js inside your browser tab. Wait for it to install, then it starts${stack.run ? ` (\`${stack.run}\`)` : ""}.` : "A full editor and preview in your tab.");
    add("codesandbox", "CodeSandbox", `https://codesandbox.io/p/github/${fn}`, "free account", "Cloud dev box with a live preview.");
  }
  for (const nb of stack.notebooks.slice(0, 2)) {
    add("colab", `Colab: ${nb}`, `https://colab.research.google.com/github/${fn}/blob/${br}/${encodeURIComponent(nb)}`, "free Google account", "Runs the notebook on Google's computers, with a free GPU if you need one.");
  }
  if (stack.kind === "python" && stack.level === "heavy") add("colab-new", "Google Colab", "https://colab.research.google.com/", "free Google account", `New notebook, then run: !git clone ${repo.url}`);
  if (stack.kind === "notebook" || stack.kind === "python") add("binder", "Binder", `https://mybinder.org/v2/gh/${fn}/${br}`, "nothing", "Free, no sign-in. Can take a few minutes to start.");
  if (stack.kind !== "docs") add("codespaces", "GitHub Codespaces", `https://codespaces.new/${fn}?quickstart=1`, "free GitHub account", "A whole Linux computer in your browser (60 free hours a month). Works for almost any repo.");
  add("github.dev", stack.kind === "docs" ? "Read it" : "Browse the code", stack.kind === "docs" ? repo.url : `https://github.dev/${fn}`, "nothing", stack.kind === "docs" ? "It's a list or guide — just read it." : "VS Code in the browser for reading and editing.");
  add("fork", "Make your own copy (fork)", `https://github.com/${fn}/fork`, "free GitHub account", "Your own copy you can change and host for free.");
  return L;
}

export function licenseNote(license) {
  if (!license) return "No license yet: you can look and learn, but you don't have permission to reuse or republish the code. Ask the author.";
  if (/^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|Unlicense|CC0-1\.0|MPL-2\.0|Zlib)$/i.test(license)) return `${license}: you can use, change and share it — keep the license file and credit the author.`;
  if (/GPL/i.test(license)) return `${license}: you can use and change it, but if you share your version you must share your code under the same license.`;
  return `${license}: read the license file before reusing it.`;
}

export function remixPrompt(repo, stack, links) {
  const best = links.find((l) => l.id !== "fork");
  return [
    `I found this GitHub project: ${repo.url}`,
    `What it says it does: "${repo.description}"`,
    "",
    "I want to run it and make my own version in my web browser, without installing anything on my computer.",
    `1. Explain what it does in plain English, in 3 sentences.`,
    `2. Walk me through running it with ${best ? best.label : "GitHub Codespaces"}, step by step, one step at a time.`,
    "3. Help me fork it and change one small thing so it's mine.",
    "4. Show me how to put my version online for free.",
    "Ask me questions first if anything is unclear.",
  ].join("\n");
}

/** Full guide record (one per repo). This is what lands in data/feed.json. */
export function buildGuide(repo, probe, addedAt) {
  const stack = detectStack(repo, probe);
  const links = launchLinks(repo, stack);
  const local = stack.kind === "docs" ? null : [
    `git clone --depth 1 ${repo.url}.git`,
    `cd ${repo.name}`,
    ...(stack.install ? [stack.install] : []),
    ...(stack.run ? [stack.run] : []),
  ].join("\n");
  return {
    ...repo,
    addedAt,
    stack: { kind: stack.kind, label: stack.label, frameworks: stack.frameworks },
    level: stack.level,
    levelText: LEVELS[stack.level],
    best: links[0]?.id || null,
    launch: links,
    install: stack.install,
    run: stack.run,
    notes: stack.notes,
    local,
    licenseNote: licenseNote(repo.license),
    prompt: remixPrompt(repo, stack, links),
  };
}

const mdEsc = (s) => String(s).replace(/([\\`*_[\]<>|])/g, "\\$1");

export function guideMarkdown(g) {
  const lines = [
    `# ${g.fullName}`,
    "",
    `> ${mdEsc(g.description)}`,
    "",
    `**${g.stack.label}** · ★ ${g.stars.toLocaleString("en-US")} · ${g.language || "no main language"} · created ${String(g.createdAt).slice(0, 10)}`,
    "",
    `**In the browser:** ${g.levelText}.`,
    "",
    "## Open it in your browser",
    "",
    "| Where | What you need | |",
    "|---|---|---|",
    ...g.launch.map((l) => `| [${mdEsc(l.label)}](${l.url}) | ${l.needs} | ${mdEsc(l.note)} |`),
    "",
  ];
  if (g.install || g.run) {
    lines.push("## Commands to type (in Codespaces or StackBlitz terminal)", "", "```sh", ...[g.install, g.run].filter(Boolean), "```", "");
  }
  if (g.notes.length) lines.push("## Heads up", "", ...g.notes.map((n) => `- ${n}`), "");
  if (g.local) lines.push("## Or run it on your own computer", "", "```sh", g.local, "```", "");
  lines.push("## Make it yours (paste this into ChatGPT, Claude or Gemini)", "", "```text", g.prompt, "```", "");
  lines.push("## License", "", g.licenseNote, "", "---", "", `Found by [github.fetch](https://github.com/rawmware/github.fetch) on ${g.addedAt.slice(0, 10)} · [all fresh repos](https://www.aictuallyhelp.com/repos.html)`, "");
  return lines.join("\n");
}

/** Commit pacing: how many scout commits are owed right now. */
export function commitsOwed({ now, doneToday, target, leadMinutes = 90, maxPerRun = 20 }) {
  const d = new Date(now);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const due = Math.min(target, Math.ceil((target * Math.min(1440, minutes + leadMinutes)) / 1440));
  return Math.max(0, Math.min(maxPerRun, due - doneToday));
}
