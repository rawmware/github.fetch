// Pure formatting helpers (no DOM). Imported by app.js and scripts/test.mjs.

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("en-US");
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** 7341 -> "7.3K" (Intl en-US compact notation). */
export function compact(n) {
  return Number.isFinite(n) ? compactFmt.format(n) : "0";
}

/** 12345 -> "12,345". */
export function integer(n) {
  return Number.isFinite(n) ? intFmt.format(Math.round(n)) : "0";
}

/** "3 hours ago", "2 days ago", "just now" for an ISO date relative to `now` (ms). */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const diff = (t - now) / 1000; // negative = past
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** Hours between an ISO date and now. */
export function hoursSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 3600000 : Infinity;
}

/** 12.7 -> "12d old", 0.2 -> "5h old". */
export function ageLabel(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 0) return "";
  if (ageDays < 1) return `${Math.max(1, Math.round(ageDays * 24))}h old`;
  return `${Math.floor(ageDays)}d old`;
}

/** 577.6 -> "578★/day", 4.25 -> "4.3★/day". */
export function perDayLabel(v) {
  if (!Number.isFinite(v)) return "";
  const n = v >= 10 ? integer(v) : String(Math.round(v * 10) / 10);
  return `${n}★/day`;
}

/** Local absolute date-time for a title attribute. */
export function absoluteTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const LANG_COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Lua: "#000080",
  Dart: "#00B4AB",
  Zig: "#ec915c",
  "Jupyter Notebook": "#DA5B0B",
};

/** Deterministic string hash (FNV-1a, 32-bit). */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Colour for a language dot. */
export function langColor(lang) {
  if (!lang) return "#71717a";
  return LANG_COLORS[lang] || `hsl(${hash(lang) % 360} 45% 60%)`;
}

export const LANG_COLOR_COUNT = Object.keys(LANG_COLORS).length;
