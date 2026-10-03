// Pure filter / sort / URL-state functions (no DOM). Imported by app.js and scripts/test.mjs.

export const WINDOW_IDS = ["24h", "7d", "30d", "all"];
export const SORTS = ["stars", "newest", "velocity", "gained"];
export const PAGE_SIZE = 30;

/** Install filter options: value -> label. Non-"all" values filter by primary family, except "oneliner". */
export const INSTALL_FILTERS = [
  { value: "all", label: "All" },
  { value: "oneliner", label: "One-liners only" },
  { value: "brew", label: "Homebrew" },
  { value: "node", label: "Node" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "shell", label: "Shell script" },
  { value: "docker", label: "Docker" },
  { value: "git", label: "Clone only" },
];
const INSTALL_VALUES = INSTALL_FILTERS.map((o) => o.value);

export function defaultState(defaultWindow = "7d") {
  return { w: defaultWindow, lang: "", m: "all", q: "", sort: "stars" };
}

/** First non-empty of 7d, 30d, else "all". */
export function pickDefaultWindow(repos) {
  for (const w of ["7d", "30d"]) if (repos.some((r) => (r.windows || []).includes(w))) return w;
  return "all";
}

export const allDeltasNull = (repos) => repos.every((r) => r.starsDelta1d === null || r.starsDelta1d === undefined);

/** Parse a query string into a validated state. opts: { defaultWindow, languages?, gainedAvailable? } */
export function parseState(search, opts = {}) {
  const p = new URLSearchParams(search || "");
  const s = defaultState(opts.defaultWindow || "7d");
  const w = p.get("w");
  if (w && WINDOW_IDS.includes(w)) s.w = w;
  const lang = p.get("lang");
  if (lang && (!opts.languages || opts.languages.includes(lang))) s.lang = lang;
  const m = p.get("m");
  if (m && INSTALL_VALUES.includes(m)) s.m = m;
  const q = p.get("q");
  if (q) s.q = q.slice(0, 100);
  const sort = p.get("sort");
  if (sort && SORTS.includes(sort) && !(sort === "gained" && opts.gainedAvailable === false)) s.sort = sort;
  return s;
}

/** Serialise state to a query string. `w` is always written; the rest only when not default. */
export function serializeState(s) {
  const p = new URLSearchParams();
  p.set("w", s.w);
  if (s.lang) p.set("lang", s.lang);
  if (s.m && s.m !== "all") p.set("m", s.m);
  if (s.q) p.set("q", s.q);
  if (s.sort && s.sort !== "stars") p.set("sort", s.sort);
  return p.toString();
}

export const matchesWindow = (r, w) => w === "all" || (r.windows || []).includes(w);
export const matchesLang = (r, lang) => !lang || r.language === lang;

export function matchesInstall(r, m) {
  if (!m || m === "all") return true;
  const p = r.install && r.install.primary;
  if (!p) return false;
  if (m === "oneliner") return p.confidence !== "fallback";
  return p.family === m;
}

export function matchesQuery(r, q) {
  const terms = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [r.fullName, r.description || "", ...(r.topics || [])].join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function filterRepos(repos, s) {
  return repos.filter(
    (r) => matchesWindow(r, s.w) && matchesLang(r, s.lang) && matchesInstall(r, s.m) && matchesQuery(r, s.q),
  );
}

const byStars = (a, b) => b.stars - a.stars || (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0);

export function sortRepos(repos, sort) {
  const list = repos.slice();
  switch (sort) {
    case "newest":
      return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || byStars(a, b));
    case "velocity":
      return list.sort((a, b) => b.starsPerDay - a.starsPerDay || byStars(a, b));
    case "gained":
      return list.sort((a, b) => {
        const an = a.starsDelta1d === null || a.starsDelta1d === undefined;
        const bn = b.starsDelta1d === null || b.starsDelta1d === undefined;
        if (an !== bn) return an ? 1 : -1;
        if (!an && b.starsDelta1d !== a.starsDelta1d) return b.starsDelta1d - a.starsDelta1d;
        return byStars(a, b);
      });
    default:
      return list.sort(byStars);
  }
}

export const applyState = (repos, s) => sortRepos(filterRepos(repos, s), s.sort);

/** [{ language, count }] sorted by count desc, then name. */
export function languageCounts(repos) {
  const m = new Map();
  for (const r of repos) if (r.language) m.set(r.language, (m.get(r.language) || 0) + 1);
  return [...m.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

/** { "24h": n, "7d": n, "30d": n, all: n } */
export function windowCounts(repos) {
  const out = { all: repos.length };
  for (const w of WINDOW_IDS.slice(0, 3)) out[w] = repos.filter((r) => matchesWindow(r, w)).length;
  return out;
}

/** The repo with the highest starsPerDay, or null. */
export function fastestRiser(repos) {
  let best = null;
  for (const r of repos) if (!best || r.starsPerDay > best.starsPerDay) best = r;
  return best;
}

/** Pick the snapshot with the later generatedAt among accepted candidates (nulls ignored). */
export function pickNewest(...snaps) {
  let best = null;
  for (const s of snaps) {
    if (!s) continue;
    if (!best || Date.parse(s.generatedAt) > Date.parse(best.generatedAt)) best = s;
  }
  return best;
}

/** True if a parsed JSON value is an acceptable snapshot (§5.2). */
export function isAcceptableSnapshot(d) {
  return Boolean(
    d && typeof d === "object" && d.schemaVersion === 1 && Array.isArray(d.repos) && Number.isFinite(Date.parse(d.generatedAt)),
  );
}
