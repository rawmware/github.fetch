// github.fetch — Day 5 of 365 Days of Showing Up.
import {
  INSTALL_FILTERS, PAGE_SIZE, parseState, serializeState, applyState, pickDefaultWindow,
  languageCounts, windowCounts, fastestRiser, allDeltasNull, pickNewest, isAcceptableSnapshot, defaultState,
} from "./lib/filter.js";
import { relativeTime, absoluteTime, hoursSince, perDayLabel, integer } from "./lib/format.js";
import { renderCard, renderSkeleton, el } from "./lib/render.js";

const $ = (id) => document.getElementById(id);
const ui = {
  results: $("results"), grid: $("grid"), more: $("more"), count: $("count"),
  error: $("error"), retry: $("retry"), empty: $("empty"), emptyText: $("empty-text"), emptyReset: $("empty-reset"),
  lastRun: $("last-run"), stale: $("stale"), announce: $("announce"),
  total: $("stat-total"), langs: $("stat-langs"), oneliner: $("stat-oneliner"), riser: $("stat-riser"), riserLabel: $("stat-riser-label"),
  form: $("controls"), lang: $("f-lang"), m: $("f-m"), q: $("f-q"), sort: $("f-sort"), reset: $("reset"),
};

const WINDOW_TEXT = { "24h": "in the last 24 hours", "7d": "in the last 7 days", "30d": "in the last 30 days", all: "" };
let data = null;
let state = defaultState();
let defaultWindow = "7d";
let shown = PAGE_SIZE;
let list = [];

// ---------- loading ----------

const localUrl = new URL("data/repos.json", import.meta.url);

function remoteUrl() {
  if (new URLSearchParams(location.search).get("offline") === "1") return null;
  const meta = document.querySelector('meta[name="gf-remote-data"]');
  const v = meta && meta.getAttribute("content");
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

async function fetchSnapshot(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { cache: "no-cache", signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return isAcceptableSnapshot(json) ? json : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function showSkeletons() {
  ui.results.setAttribute("aria-busy", "true");
  ui.error.hidden = true;
  ui.empty.hidden = true;
  ui.more.hidden = true;
  ui.grid.replaceChildren(renderSkeleton(), renderSkeleton(), renderSkeleton());
  ui.count.textContent = "Loading repos…";
}

async function load() {
  showSkeletons();
  const remote = remoteUrl();
  const [local, live] = await Promise.all([
    fetchSnapshot(localUrl),
    remote ? fetchSnapshot(remote, 6000) : Promise.resolve(null),
  ]);
  const snap = pickNewest(local, live);
  ui.results.setAttribute("aria-busy", "false");
  if (!snap) {
    ui.grid.replaceChildren();
    ui.count.textContent = "";
    ui.error.hidden = false;
    return;
  }
  data = snap;
  init();
}

// ---------- setup ----------

function init() {
  const repos = data.repos;
  defaultWindow = pickDefaultWindow(repos);

  // status + stale badge
  ui.lastRun.textContent = relativeTime(data.generatedAt);
  ui.lastRun.setAttribute("datetime", data.generatedAt);
  ui.lastRun.setAttribute("title", absoluteTime(data.generatedAt));
  const age = hoursSince(data.generatedAt);
  if (age > 36) {
    const days = Math.max(1, Math.round(age / 24));
    ui.stale.textContent = `Last update was ${days} day${days === 1 ? "" : "s"} ago — the daily job may be paused.`;
    ui.stale.hidden = false;
  } else {
    ui.stale.hidden = true;
  }

  // stats
  const s = data.stats || {};
  ui.total.textContent = integer(repos.length);
  ui.langs.textContent = integer(s.languages ?? languageCounts(repos).length);
  const one = repos.filter((r) => r.install && r.install.primary && r.install.primary.confidence !== "fallback").length;
  ui.oneliner.textContent = repos.length ? `${Math.round((one / repos.length) * 100)}%` : "—";
  const riser = fastestRiser(repos);
  if (riser) {
    ui.riser.textContent = riser.name;
    ui.riser.setAttribute("title", riser.fullName);
    ui.riserLabel.textContent = `fastest riser · ${perDayLabel(riser.starsPerDay)}`;
  }

  // window counts
  const wc = windowCounts(repos);
  for (const em of document.querySelectorAll("[data-count]")) em.textContent = `(${wc[em.getAttribute("data-count")] ?? 0})`;

  // language select
  const langs = languageCounts(repos);
  ui.lang.replaceChildren(el("option", { value: "", text: "All languages" }));
  for (const { language, count } of langs) ui.lang.append(el("option", { value: language, text: `${language} (${count})` }));

  // install select
  ui.m.replaceChildren(...INSTALL_FILTERS.map((o) => el("option", { value: o.value, text: o.label })));

  // sort: hide "Gained today" when no deltas exist
  const gainedAvailable = !allDeltasNull(repos);
  const gainedOpt = ui.sort.querySelector('option[value="gained"]');
  if (!gainedAvailable && gainedOpt) gainedOpt.remove();

  state = parseState(location.search, { defaultWindow, languages: langs.map((l) => l.language), gainedAvailable });
  writeControls();
  render(true);
}

function writeControls() {
  for (const r of ui.form.querySelectorAll('input[name="w"]')) r.checked = r.value === state.w;
  ui.lang.value = state.lang;
  ui.m.value = state.m;
  if (ui.q.value !== state.q) ui.q.value = state.q;
  ui.sort.value = state.sort;
}

function syncUrl() {
  const qs = serializeState(state);
  try {
    history.replaceState(null, "", location.pathname + "?" + qs);
  } catch {
    /* sandboxed contexts may refuse; state still works */
  }
}

// ---------- rendering ----------

function render(resetPaging) {
  if (!data) return;
  if (resetPaging) shown = PAGE_SIZE;
  list = applyState(data.repos, state);
  const visible = list.slice(0, shown);
  ui.grid.replaceChildren(...visible.map((r, i) => renderCard(r, i + 1, { onCopy: copyCommand })));
  ui.more.hidden = list.length <= shown;
  ui.count.textContent = `Showing ${visible.length} of ${list.length} repo${list.length === 1 ? "" : "s"}`;

  if (!list.length) {
    const onlyWindow = !state.lang && state.m === "all" && !state.q;
    ui.emptyText.textContent = onlyWindow && state.w !== "all"
      ? `No repos were created ${WINDOW_TEXT[state.w]} with enough stars yet — try a longer window.`
      : "No repos match these filters.";
    ui.empty.hidden = false;
  } else {
    ui.empty.hidden = true;
  }
  syncUrl();
}

function showMore() {
  const start = shown;
  shown += PAGE_SIZE;
  const add = list.slice(start, shown);
  ui.grid.append(...add.map((r, i) => renderCard(r, start + i + 1, { onCopy: copyCommand })));
  ui.more.hidden = list.length <= shown;
  ui.count.textContent = `Showing ${Math.min(shown, list.length)} of ${list.length} repos`;
  const firstNew = ui.grid.children[start];
  const link = firstNew && firstNew.querySelector("h3 a");
  if (link) link.focus();
}

// ---------- copy ----------

function announce(msg) {
  ui.announce.textContent = "";
  // re-set on the next frame so repeated messages are announced
  requestAnimationFrame(() => { ui.announce.textContent = msg; });
}

function legacyCopy(text) {
  const ta = el("textarea", { class: "clip-helper", readonly: "", "aria-hidden": "true", tabindex: "-1" });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

async function copyCommand(cmd, button, codeEl) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(cmd);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = legacyCopy(cmd);
  if (ok) {
    button.textContent = "Copied ✓";
    button.classList.add("is-copied");
    clearTimeout(button._t);
    button._t = setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("is-copied");
    }, 1500);
    announce(`Copied: ${cmd}`);
  } else {
    const range = document.createRange();
    range.selectNodeContents(codeEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    announce("Press Ctrl+C to copy");
  }
}

// ---------- events ----------

let debounce = null;
ui.form.addEventListener("submit", (e) => e.preventDefault());
ui.form.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "w") state.w = t.value;
  else if (t === ui.lang) state.lang = t.value;
  else if (t === ui.m) state.m = t.value;
  else if (t === ui.sort) state.sort = t.value;
  else return;
  render(true);
});
ui.q.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.q = ui.q.value.trim().slice(0, 100);
    render(true);
  }, 120);
});
function resetFilters() {
  state = defaultState(defaultWindow);
  writeControls();
  render(true);
}
ui.reset.addEventListener("click", resetFilters);
ui.emptyReset.addEventListener("click", resetFilters);
ui.more.addEventListener("click", showMore);
ui.retry.addEventListener("click", load);

// Skip link + brand button: focus targets in JS, so no fragment URLs are
// needed (safe under a <base href> on rawmware.com).
document.addEventListener("click", (e) => {
  const j = e.target.closest("[data-jump]");
  if (!j) return;
  e.preventDefault();
  const id = j.getAttribute("data-jump");
  const target = document.getElementById(id);
  if (!target) return;
  if (id === "top") window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  target.focus({ preventScroll: id === "top" });
});

// keep "last run" fresh if the tab stays open
setInterval(() => {
  if (data) ui.lastRun.textContent = relativeTime(data.generatedAt);
}, 60000);

load();
