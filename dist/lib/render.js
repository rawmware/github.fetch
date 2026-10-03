// DOM builders. All data enters the DOM via textContent, setAttribute on safe
// attributes, or validated URLs. No innerHTML anywhere.
import { compact, ageLabel, perDayLabel, langColor, integer } from "./format.js";

/** Accept only https: URLs (and, if given, hosts in the allowlist). Returns a URL string or null. */
export function safeUrl(u, allowedHosts) {
  if (typeof u !== "string" || !u) return null;
  let url;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (allowedHosts && !allowedHosts.includes(url.hostname)) return null;
  return url.href;
}

/** Tiny element helper. attrs: plain attributes (strings), plus `class`, `text`. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = String(v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function link(href, text, extra = {}) {
  const a = el("a", { target: "_blank", rel: "noopener noreferrer", ...extra });
  a.href = href;
  a.textContent = text;
  return a;
}

const PLATFORM_LABEL = { "macos-linux": "macOS/Linux", windows: "Windows" };

function badgeText(o) {
  if (o.confidence === "readme") return "from README";
  if (o.confidence === "manifest") return `from ${o.source || "manifest"}`;
  if (o.confidence === "clone") return "source checkout";
  return "fallback";
}

/** All selectable install options for a repo: primary, alternates, then clone. */
export function installOptions(install) {
  const opts = [install.primary, ...(install.alternates || [])];
  if (!opts.some((o) => o.command === install.clone)) {
    opts.push({
      method: "clone", family: "git", label: "git clone", command: install.clone,
      confidence: "clone", source: null, platform: "any", note: null,
    });
  }
  return opts;
}

function buildInstall(repo, onCopy) {
  const opts = installOptions(repo.install);
  const wrap = el("div", { class: "install" });
  const switcher = el("div", { class: "switch", role: "group", "aria-label": `Install method for ${repo.fullName}` });
  const code = el("code");
  const pre = el("pre", { class: "cmd", tabindex: "0", "aria-label": `Install command for ${repo.fullName}` }, code);
  const copy = el("button", { type: "button", class: "copy", "aria-label": `Copy install command for ${repo.fullName}`, text: "Copy" });
  const meta = el("p", { class: "install-meta" });
  const badge = el("span", { class: "badge" });
  const platform = el("span", { class: "platform" });
  const note = el("p", { class: "note" });
  meta.append(badge, platform);

  const buttons = opts.map((o, i) => {
    const b = el("button", { type: "button", "aria-pressed": i === 0 ? "true" : "false", text: o.label });
    b.addEventListener("click", () => select(i));
    switcher.append(b);
    return b;
  });

  let current = opts[0];
  function select(i) {
    current = opts[i];
    buttons.forEach((b, j) => b.setAttribute("aria-pressed", j === i ? "true" : "false"));
    code.textContent = current.command;
    badge.textContent = badgeText(current);
    badge.className = `badge badge--${current.confidence}`;
    if (current.confidence === "readme" && current.source) badge.setAttribute("title", current.source);
    else badge.removeAttribute("title");
    const plat = PLATFORM_LABEL[current.platform];
    platform.textContent = plat || "";
    platform.hidden = !plat;
    note.textContent = current.note || "";
    note.hidden = !current.note;
    note.className = current.method === "curl-sh" || current.method === "powershell" ? "note note--warn" : "note";
  }
  select(0);
  copy.addEventListener("click", () => onCopy(current.command, copy, code));

  if (opts.length > 1) wrap.append(switcher);
  wrap.append(el("div", { class: "cmd-row" }, pre, copy), meta, note);
  return wrap;
}

/** One repo card: <li><article>…</article></li>. */
export function renderCard(repo, rank, { onCopy }) {
  const li = el("li", { class: "card-item" });
  const art = el("article", { class: "card" });

  const head = el("header", { class: "card-head" });
  head.append(el("span", { class: "rank", text: `#${rank}` }));
  const avatar = safeUrl(repo.avatarUrl, ["avatars.githubusercontent.com"]);
  if (avatar) {
    const img = el("img", { class: "avatar", width: "32", height: "32", loading: "lazy", alt: "", referrerpolicy: "no-referrer" });
    img.src = avatar + (avatar.includes("?") ? "&s=64" : "?s=64");
    head.append(img);
  }
  const repoUrl = safeUrl(repo.url, ["github.com"]);
  const h3 = el("h3", { class: "repo-name" });
  const nameNodes = [document.createTextNode(`${repo.owner}/`), el("b", { text: repo.name })];
  if (repoUrl) {
    const a = el("a", { target: "_blank", rel: "noopener noreferrer" }, ...nameNodes);
    a.href = repoUrl;
    h3.append(a);
  } else {
    h3.append(...nameNodes);
  }
  head.append(h3);
  art.append(head);

  if (repo.description) art.append(el("p", { class: "desc", title: repo.description, text: repo.description }));

  const meta = el("ul", { class: "meta", "aria-label": "Repository stats" });
  if (repo.language) {
    const dot = el("span", { class: "dot", "aria-hidden": "true" });
    dot.style.setProperty("--lang", langColor(repo.language));
    meta.append(el("li", { class: "lang" }, dot, repo.language));
  }
  meta.append(el("li", { title: `${integer(repo.stars)} stars`, text: `★ ${compact(repo.stars)}` }));
  if (repo.starsDelta1d > 0) meta.append(el("li", { class: "gain", text: `+${integer(repo.starsDelta1d)} today` }));
  const age = ageLabel(repo.ageDays);
  if (age) meta.append(el("li", { text: age }));
  const pd = perDayLabel(repo.starsPerDay);
  if (pd) meta.append(el("li", { text: pd }));
  if (repo.license) meta.append(el("li", { class: "license", text: repo.license }));
  art.append(meta);

  const topics = (repo.topics || []).slice(0, 5);
  if (topics.length) {
    const ul = el("ul", { class: "topics", "aria-label": "Topics" });
    for (const t of topics) ul.append(el("li", { text: t }));
    art.append(ul);
  }

  art.append(buildInstall(repo, onCopy));

  const foot = el("footer", { class: "card-foot" });
  if (repoUrl) foot.append(link(repoUrl, "Repo ↗"));
  const hp = safeUrl(repo.homepage);
  if (hp) foot.append(link(hp, "Homepage ↗"));
  art.append(foot);

  li.append(art);
  return li;
}

/** Placeholder card shown while loading. */
export function renderSkeleton() {
  const li = el("li", { class: "card-item", "aria-hidden": "true" });
  const art = el("div", { class: "card skeleton" });
  for (const c of ["sk-line sk-title", "sk-line", "sk-line sk-short", "sk-block"]) art.append(el("div", { class: c }));
  li.append(art);
  return li;
}
