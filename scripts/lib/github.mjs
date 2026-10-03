// Network helpers. Node >= 20 built-ins only.

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

function headers() {
  const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "github.fetch-scout" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout + up to `tries` attempts on network errors, 5xx, 429 and rate-limit 403s. */
export async function fetchRetry(url, { tries = 3, timeout = 15000, ...opts } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
      const limited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
      if (res.status < 500 && !limited) return res;
      last = new Error(`HTTP ${res.status} for ${url}`);
      const reset = Number(res.headers.get("retry-after")) || Math.max(0, Number(res.headers.get("x-ratelimit-reset")) - Date.now() / 1000);
      await sleep(Math.min(60, reset || 2 * (i + 1) ** 2) * 1000);
    } catch (e) {
      last = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

export async function searchRepos(q, perPage = 100, page = 1) {
  const url = `${API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`;
  const res = await fetchRetry(url, { headers: headers() });
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).items || [];
}

export async function getRepo(fullName) {
  const res = await fetchRetry(`${API}/repos/${fullName}`, { headers: headers() });
  return res.ok ? res.json() : null;
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

export async function rawFile(fullName, branch, path, maxBytes = 65536) {
  try {
    const res = await fetchRetry(`${RAW}/${fullName}/${encodeURIComponent(branch)}/${encPath(path)}`, { tries: 2, timeout: 10000 });
    if (!res.ok) return null;
    return (await res.text()).slice(0, maxBytes);
  } catch {
    return null;
  }
}

const PROBE_FILES = ["package.json", "index.html", "requirements.txt", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod", "Dockerfile",
  "docker-compose.yml", "compose.yaml", "pnpm-lock.yaml", "yarn.lock", "pnpm-workspace.yaml", "turbo.json", "bun.lock", "bun.lockb", "app.py", "main.py", "main.go"];

/** Root file names. Uses the contents API; falls back to probing well-known files on raw.githubusercontent.com. */
export async function rootFiles(fullName, branch) {
  try {
    const res = await fetchRetry(`${API}/repos/${fullName}/contents/?ref=${encodeURIComponent(branch)}`, { headers: headers(), tries: 2 });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) return list.filter((e) => e.type === "file").map((e) => e.name);
    }
  } catch { /* fall through */ }
  const found = await Promise.all(PROBE_FILES.map(async (f) => {
    try {
      const res = await fetchRetry(`${RAW}/${fullName}/${encodeURIComponent(branch)}/${encPath(f)}`, { method: "HEAD", tries: 1, timeout: 8000 });
      return res.ok ? f : null;
    } catch { return null; }
  }));
  return found.filter(Boolean);
}

/** Everything detectStack() needs for one repo. */
export async function probeRepo(repo) {
  const files = await rootFiles(repo.fullName, repo.branch);
  const lower = new Set(files.map((f) => f.toLowerCase()));
  const pick = (name) => files.find((f) => f.toLowerCase() === name);
  const [packageJson, requirements, pyproject] = await Promise.all([
    lower.has("package.json") ? rawFile(repo.fullName, repo.branch, pick("package.json")) : null,
    lower.has("requirements.txt") ? rawFile(repo.fullName, repo.branch, pick("requirements.txt")) : null,
    lower.has("pyproject.toml") ? rawFile(repo.fullName, repo.branch, pick("pyproject.toml")) : null,
  ]);
  return { files, packageJson, requirements, pyproject };
}
