#!/usr/bin/env node
// Copy the built site into a rawmware.01 checkout as Day 5 (§8.2).
// Usage: node scripts/export-rawmware.mjs <path-to-rawmware.01>
import { readFile, writeFile, mkdir, cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BASE_HREF = "/365-days/projects/day-005/";
const FILES = ["index.html", "styles.css", "app.js", "icon.svg", "lib", "data/repos.json"];

const CHARSET_RE = /<meta charset="utf-8">/i;

/**
 * Insert `<base href>` immediately after `<meta charset="utf-8">`, exactly once.
 * Throws if there is no charset meta. If a <base> already exists, it is replaced.
 */
export function injectBase(html, href) {
  if (!CHARSET_RE.test(html)) throw new Error('index.html has no <meta charset="utf-8">');
  if (/["<>]/.test(href)) throw new Error("invalid base href");
  const stripped = html.replace(/\n?<base\b[^>]*>/gi, "");
  return stripped.replace(CHARSET_RE, (m) => `${m}\n<base href="${href}">`);
}

async function exists(p, kind) {
  try {
    const s = await stat(p);
    return kind === "dir" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}

async function main(argv) {
  const target = argv[0];
  if (!target) {
    console.error("Usage: node scripts/export-rawmware.mjs <path-to-rawmware.01>");
    return 2;
  }
  const repo = path.resolve(process.cwd(), target);
  const projects = path.join(repo, "dist/365-days/projects");
  if (!(await exists(path.join(repo, "vercel.json"), "file")) || !(await exists(projects, "dir"))) {
    console.error(`refusing: ${repo} does not look like a rawmware checkout (needs vercel.json and dist/365-days/projects/)`);
    return 1;
  }
  const outDir = path.join(projects, "day-005");
  await mkdir(path.join(outDir, "data"), { recursive: true });
  for (const f of FILES) {
    await cp(path.join(DIST, f), path.join(outDir, f), { recursive: true, force: true });
    console.log(`  copied ${f}`);
  }
  const html = await readFile(path.join(DIST, "index.html"), "utf8");
  await writeFile(path.join(projects, "day-005.html"), injectBase(html, BASE_HREF));
  console.log(`  wrote day-005.html with <base href="${BASE_HREF}">`);
  console.log(`done → ${path.relative(process.cwd(), outDir) || outDir}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`error: ${err.message}`);
      process.exit(1);
    },
  );
}
