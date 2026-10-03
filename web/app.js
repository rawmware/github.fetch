const REPO = "rawmware/github.fetch";
const FEED_URL = `https://raw.githubusercontent.com/${REPO}/main/data/feed.json`;
const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?sha=main&per_page=100`;
const ACCESS_LABELS = {
  instant: "Runs instantly",
  account: "Free account",
  read: "Read in browser",
  heavy: "Needs a machine",
};

const state = { items: [], level: "all", search: "", sort: "newest" };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function relativeTime(value) {
  const date = safeDate(value);
  if (!date) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - date) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function compact(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied ✓";
    setTimeout(() => { button.textContent = original; }, 1500);
  } catch {
    button.textContent = "Copy failed";
  }
}

function createCard(repo) {
  const fragment = $("#repo-template").content.cloneNode(true);
  const card = $(".repo-card", fragment);
  const badge = $(".access-badge", card);
  badge.dataset.level = repo.level || "account";
  badge.textContent = ACCESS_LABELS[repo.level] || "Open in browser";
  $(".repo-stars", card).textContent = `★ ${compact(repo.stars)}`;
  const avatar = $(".repo-avatar", card);
  avatar.src = repo.avatar || "";
  avatar.alt = `${repo.owner || "Repository"} avatar`;
  $(".repo-owner", card).textContent = repo.owner || "unknown owner";
  $(".repo-name", card).textContent = repo.name || repo.fullName || "Untitled repository";
  $(".repo-description", card).textContent = repo.description || "No description supplied by the repository author.";

  const tags = $(".repo-tags", card);
  [repo.language, repo.stack?.label, ...(repo.topics || []).slice(0, 2)].filter(Boolean).forEach((value) => {
    const tag = document.createElement("span");
    tag.textContent = value;
    tags.append(tag);
  });

  const command = repo.run || repo.install || repo.local?.split("\n").at(-1);
  const commandBox = $(".command", card);
  if (command) {
    commandBox.hidden = false;
    $("code", commandBox).textContent = command;
    $(".copy-command", commandBox).addEventListener("click", (event) => copy(command, event.currentTarget));
  }

  const best = (repo.launch || []).find((item) => item.id === repo.best) || repo.launch?.[0];
  const launch = $(".launch-link", card);
  if (best) {
    launch.href = best.url;
    launch.textContent = `${best.label} ↗`;
  } else {
    launch.href = repo.url;
    launch.textContent = "Open repository ↗";
  }
  const source = $(".source-link", card);
  source.href = repo.url;
  $(".access-note", card).textContent = best ? `${repo.levelText}. Best route: ${best.label}; needs ${best.needs}.` : repo.levelText;
  $(".license-note", card).textContent = repo.licenseNote || "Check the repository license before reusing its code.";
  $(".copy-prompt", card).addEventListener("click", (event) => copy(repo.prompt || `Help me understand and build on ${repo.url}`, event.currentTarget));
  return fragment;
}

function filteredItems() {
  const phrase = state.search.trim().toLowerCase();
  const output = state.items.filter((repo) => {
    if (state.level !== "all" && repo.level !== state.level) return false;
    if (!phrase) return true;
    return [repo.fullName, repo.description, repo.language, repo.stack?.label, ...(repo.topics || [])]
      .filter(Boolean).join(" ").toLowerCase().includes(phrase);
  });
  if (state.sort === "stars") output.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  if (state.sort === "fresh") output.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (state.sort === "newest") output.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  return output;
}

function render() {
  const grid = $("#repo-grid");
  const items = filteredItems();
  grid.replaceChildren(...items.map(createCard));
  $("#result-count").textContent = `${items.length} of ${state.items.length} repositories shown`;
  $("#empty-state").hidden = items.length > 0;
}

function updateSummary(feed) {
  $("#guide-total").textContent = compact(feed.totalGuides);
  $("#instant-total").textContent = compact(feed.levels?.instant || 0);
  $("#language-total").textContent = new Set(feed.items.map((item) => item.language).filter(Boolean)).size;
  $("#feed-age").textContent = relativeTime(feed.updatedAt);
  $("#data-source").textContent = `Live snapshot · ${feed.totalGuides} guides · updated ${new Date(feed.updatedAt).toLocaleString()}`;
}

async function loadFeed() {
  const response = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  const feed = await response.json();
  if (feed.schemaVersion !== 1 || !Array.isArray(feed.items)) throw new Error("Feed shape is invalid");
  state.items = feed.items;
  updateSummary(feed);
  render();
}

function utcDay(value) {
  return safeDate(value)?.toISOString().slice(0, 10);
}

async function loadCommitProof() {
  const response = await fetch(`${COMMITS_URL}&t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`Commit proof returned HTTP ${response.status}`);
  const commits = await response.json();
  const today = new Date().toISOString().slice(0, 10);
  const count = commits.filter((item) => {
    const subject = String(item.commit?.message || "").split("\n")[0];
    return subject.startsWith("scout:") && utcDay(item.commit?.author?.date) === today;
  }).length;
  $("#commit-count").textContent = count;
  $("#commit-meter").style.width = `${Math.min(100, count / 60 * 100)}%`;
  $("#pulse-state").textContent = count >= 60
    ? `Goal met: ${count} verified scout commits on main today.`
    : `In motion: ${Math.max(0, 60 - count)} more commits to today’s floor.`;
}

async function refresh() {
  const button = $("#refresh-button");
  button.disabled = true;
  button.textContent = "↻ Refreshing…";
  const outcomes = await Promise.allSettled([loadFeed(), loadCommitProof()]);
  if (outcomes[0].status === "rejected") {
    $("#result-count").textContent = `Live feed unavailable: ${outcomes[0].reason.message}`;
  }
  if (outcomes[1].status === "rejected") {
    $("#pulse-state").textContent = "Could not verify GitHub commits right now. Use the proof link below.";
  }
  button.disabled = false;
  button.textContent = "↻ Refresh live data";
}

function wireControls() {
  $("#search").addEventListener("input", (event) => { state.search = event.target.value; render(); });
  $("#sort").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  $("#level-filter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-level]");
    if (!button) return;
    state.level = button.dataset.level;
    $$("button", event.currentTarget).forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
  $("#refresh-button").addEventListener("click", refresh);
}

function tickClock() {
  $("#utc-clock").textContent = `${new Date().toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} UTC`;
}

wireControls();
tickClock();
setInterval(tickClock, 30_000);
refresh();
