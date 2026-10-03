// validateSnapshot(obj) -> { ok, errors }. Pure, no I/O. (§3.4)
import { isSafeCommand, CONFIDENCE, FAMILIES, PLATFORMS, METHOD_BY_ID } from "./install-detect.mjs";

const FULLNAME_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const isDate = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const isCount = (v) => Number.isInteger(v) && v >= 0;

function checkOption(o, where, clone, errors) {
  if (!o || typeof o !== "object") {
    errors.push(`${where}: not an object`);
    return;
  }
  if (o.method !== "clone" && !METHOD_BY_ID[o.method]) errors.push(`${where}: unknown method ${o.method}`);
  if (!FAMILIES.includes(o.family)) errors.push(`${where}: bad family ${o.family}`);
  if (!CONFIDENCE.includes(o.confidence)) errors.push(`${where}: bad confidence ${o.confidence}`);
  if (!PLATFORMS.includes(o.platform)) errors.push(`${where}: bad platform ${o.platform}`);
  if (typeof o.label !== "string" || !o.label) errors.push(`${where}: missing label`);
  if (o.source !== null && typeof o.source !== "string") errors.push(`${where}: bad source`);
  if (o.note !== null && (typeof o.note !== "string" || o.note.length > 140)) errors.push(`${where}: bad note`);
  if (o.command !== clone && !isSafeCommand(o.command)) errors.push(`${where}: unsafe command ${JSON.stringify(o.command)}`);
  if (o.confidence === "fallback" && o.command !== clone) errors.push(`${where}: fallback must be the clone command`);
}

export function validateSnapshot(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["snapshot is not an object"] };
  if (obj.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!isDate(obj.generatedAt)) errors.push("generatedAt is not a date");
  if (!isDate(obj.snapshotAt)) errors.push("snapshotAt is not a date");
  const windowIds = Array.isArray(obj.windows) ? obj.windows.map((w) => w && w.id) : [];
  if (!windowIds.length) errors.push("windows missing");
  const repos = obj.repos;
  if (!Array.isArray(repos)) {
    errors.push("repos is not an array");
    return { ok: false, errors };
  }
  if (repos.length < 1 || repos.length > 300) errors.push(`repos must have 1–300 entries (has ${repos.length})`);

  const seen = new Set();
  repos.forEach((r, i) => {
    const at = `repos[${i}]${r && r.fullName ? ` (${r.fullName})` : ""}`;
    if (!r || typeof r !== "object") {
      errors.push(`${at}: not an object`);
      return;
    }
    if (typeof r.fullName !== "string" || !FULLNAME_RE.test(r.fullName)) errors.push(`${at}: bad fullName`);
    if (seen.has(r.fullName)) errors.push(`${at}: duplicate fullName`);
    seen.add(r.fullName);
    const url = `https://github.com/${r.fullName}`;
    if (r.url !== url) errors.push(`${at}: url mismatch`);
    if (typeof r.fullName === "string" && `${r.owner}/${r.name}` !== r.fullName) errors.push(`${at}: owner/name mismatch`);
    if (typeof r.avatarUrl !== "string" || !r.avatarUrl.startsWith("https://avatars.githubusercontent.com/")) errors.push(`${at}: bad avatarUrl`);
    if (r.homepage !== null && !(typeof r.homepage === "string" && /^https?:\/\//.test(r.homepage))) errors.push(`${at}: bad homepage`);
    for (const k of ["stars", "forks", "openIssues"]) if (!isCount(r[k])) errors.push(`${at}: ${k} must be an integer >= 0`);
    if (!Array.isArray(r.topics) || r.topics.some((t) => typeof t !== "string")) errors.push(`${at}: topics must be string[]`);
    if (!Array.isArray(r.windows) || r.windows.some((w) => !windowIds.includes(w))) errors.push(`${at}: windows not declared`);
    const inst = r.install;
    if (!inst || typeof inst !== "object") {
      errors.push(`${at}: install missing`);
      return;
    }
    const clone = `git clone --depth 1 ${url}.git`;
    if (inst.clone !== clone) errors.push(`${at}: wrong clone command`);
    checkOption(inst.primary, `${at}.primary`, clone, errors);
    if (!Array.isArray(inst.alternates)) errors.push(`${at}: alternates must be an array`);
    else {
      if (inst.alternates.length > 3) errors.push(`${at}: more than 3 alternates`);
      const cmds = new Set([inst.primary && inst.primary.command]);
      inst.alternates.forEach((o, j) => {
        checkOption(o, `${at}.alternates[${j}]`, clone, errors);
        if (o && cmds.has(o.command)) errors.push(`${at}: duplicate install command ${JSON.stringify(o.command)}`);
        if (o) cmds.add(o.command);
      });
    }
  });

  // stats agree with repos
  const s = obj.stats;
  if (!s || typeof s !== "object") errors.push("stats missing");
  else if (errors.length === 0) {
    const byMethod = {};
    const langs = new Set();
    let one = 0;
    for (const r of repos) {
      const p = r.install.primary;
      byMethod[p.method] = (byMethod[p.method] || 0) + 1;
      if (p.confidence !== "fallback") one++;
      if (r.language) langs.add(r.language);
    }
    if (s.total !== repos.length) errors.push("stats.total disagrees with repos");
    if (s.withOneLiner !== one) errors.push("stats.withOneLiner disagrees with repos");
    if (s.languages !== langs.size) errors.push("stats.languages disagrees with repos");
    const a = s.byMethod || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(byMethod)]);
    for (const k of keys) if ((a[k] || 0) !== (byMethod[k] || 0)) errors.push(`stats.byMethod.${k} disagrees with repos`);
  }
  return { ok: errors.length === 0, errors };
}
