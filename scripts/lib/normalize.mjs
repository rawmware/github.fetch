// API item -> Repo, plus the spam / quality filters (§4.3). Pure.

export const WINDOWS = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 168 },
  { id: "30d", label: "Last 30 days", hours: 720 },
];

export const SPAM_RE =
  /\b(cheats?|hack(s|ed)?|crack(ed)?|keygen|aimbot|wallhack|mod ?menu|robux|v-?bucks|free (download|premium)|generator 202\d|unlock(er)?|spoofer|injector)\b/i;
export const BAD_TOPICS = ["cheat", "hack", "crack", "keygen", "aimbot", "spoofer"];
const FULLNAME_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

export const isSpamDescription = (d) => SPAM_RE.test(String(d ?? ""));

/** Why an item is dropped, or null to keep it. */
export function dropReason(item) {
  if (!item || typeof item !== "object") return "not an object";
  if (typeof item.full_name !== "string" || !FULLNAME_RE.test(item.full_name)) return "bad full_name";
  if (item.fork === true || item.archived === true || item.disabled === true) return "fork/archived/disabled";
  if (!Number.isFinite(Date.parse(item.created_at))) return "bad created_at";
  const desc = typeof item.description === "string" ? item.description.trim() : "";
  if (desc.length < 10) return "no description";
  if (isSpamDescription(desc)) return "spam description";
  const topics = Array.isArray(item.topics) ? item.topics : [];
  if (topics.some((t) => BAD_TOPICS.includes(String(t).toLowerCase()))) return "spam topic";
  return null;
}

export const keepItem = (item) => dropReason(item) === null;

/** Merge, dedupe by full_name (case-insensitive, first wins), sort by stars desc then name. */
export function dedupeAndSort(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = String(it?.full_name ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.sort(compareRepoItems);
}

function compareRepoItems(a, b) {
  const sa = a.stargazers_count ?? a.stars ?? 0;
  const sb = b.stargazers_count ?? b.stars ?? 0;
  if (sb !== sa) return sb - sa;
  const na = a.full_name ?? a.fullName ?? "";
  const nb = b.full_name ?? b.fullName ?? "";
  return na < nb ? -1 : na > nb ? 1 : 0;
}

export const compareRepos = (a, b) =>
  b.stars - a.stars || (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0);

const toInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function normLicense(l) {
  let id = null;
  if (typeof l === "string") id = l;
  else if (l && typeof l === "object" && typeof l.spdx_id === "string") id = l.spdx_id;
  if (!id || id === "NOASSERTION") return null;
  return id;
}

function normHomepage(h) {
  if (typeof h !== "string") return null;
  const s = h.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    new URL(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Normalise a GitHub search item into a Repo (without `install`).
 * opts: { snapshotAt: ISO string, windows?: WINDOWS }
 */
export function normalizeRepo(item, opts) {
  const snap = Date.parse(opts.snapshotAt);
  const windows = opts.windows || WINDOWS;
  const fullName = item.full_name;
  const [ownerPart, namePart] = fullName.split("/");
  const owner = ownerPart;
  const name = namePart;
  const url = `https://github.com/${fullName}`;
  const avatar = item.owner && typeof item.owner.avatar_url === "string" ? item.owner.avatar_url : "";
  const avatarUrl = avatar.startsWith("https://avatars.githubusercontent.com/")
    ? avatar
    : `https://avatars.githubusercontent.com/${owner}`;
  const description = String(item.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300).trim();
  const topics = (Array.isArray(item.topics) ? item.topics : [])
    .filter((t) => typeof t === "string" && t)
    .slice(0, 10);
  const stars = toInt(item.stargazers_count);
  const createdAt = item.created_at;
  const created = Date.parse(createdAt);
  const ageDays = round(Math.max(0, (snap - created) / 86400000), 2);
  const starsPerDay = round(stars / Math.max(ageDays, 1), 1);
  const inWindows = windows.filter((w) => created >= snap - w.hours * 3600000).map((w) => w.id);
  return {
    fullName,
    owner,
    name,
    url,
    avatarUrl,
    homepage: normHomepage(item.homepage),
    description,
    language: typeof item.language === "string" && item.language ? item.language : null,
    topics,
    license: normLicense(item.license),
    stars,
    forks: toInt(item.forks_count),
    openIssues: toInt(item.open_issues_count),
    createdAt,
    pushedAt: item.pushed_at ?? null,
    defaultBranch: typeof item.default_branch === "string" && item.default_branch ? item.default_branch : "main",
    ageDays,
    starsPerDay,
    starsDelta1d: null,
    windows: inWindows,
  };
}

/**
 * Pick the newest history snapshot 18–30 h older than snapshotAt.
 * history: [{ snapshotAt, repos: [{fullName, stars}] }]
 */
export function pickDeltaBase(history, snapshotAt) {
  const snap = Date.parse(snapshotAt);
  let best = null;
  for (const h of history) {
    const t = Date.parse(h?.snapshotAt);
    if (!Number.isFinite(t)) continue;
    const age = snap - t;
    if (age < 18 * 3600000 || age > 30 * 3600000) continue;
    if (!best || t > Date.parse(best.snapshotAt)) best = h;
  }
  return best;
}

/** Sets starsDelta1d on each repo from a history base (or null). */
export function applyDeltas(repos, base) {
  const prev = new Map();
  for (const r of base?.repos || []) {
    if (r && typeof r.fullName === "string" && Number.isInteger(r.stars)) prev.set(r.fullName.toLowerCase(), r.stars);
  }
  for (const r of repos) {
    const p = prev.get(r.fullName.toLowerCase());
    r.starsDelta1d = p === undefined ? null : r.stars - p;
  }
  return repos;
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** §4.2 live queries for a given snapshot time. */
export function buildQueries(snapshotAt) {
  const T = Date.parse(snapshotAt);
  const day = (ms) => iso(ms).slice(0, 10);
  const tail = "fork:false archived:false mirror:false is:public";
  return [
    { window: "24h", q: `created:>=${iso(T - 24 * 3600000)} stars:>=5 ${tail}`, perPage: 50 },
    { window: "7d", q: `created:>=${day(T - 7 * 86400000)} stars:>=25 ${tail}`, perPage: 100 },
    { window: "30d", q: `created:>=${day(T - 30 * 86400000)} stars:>=100 ${tail}`, perPage: 100 },
  ];
}

export function computeStats(repos) {
  const byMethod = {};
  const langs = new Set();
  let withOneLiner = 0;
  for (const r of repos) {
    const p = r.install.primary;
    byMethod[p.method] = (byMethod[p.method] || 0) + 1;
    if (p.confidence !== "fallback") withOneLiner++;
    if (r.language) langs.add(r.language);
  }
  return { total: repos.length, withOneLiner, languages: langs.size, byMethod };
}
