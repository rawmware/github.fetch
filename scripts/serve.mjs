#!/usr/bin/env node
// Local static server for dist/ (§7.3). Emulates Vercel cleanUrls and applies
// the response headers from vercel.json, so CSP problems show up locally.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 4185;
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let extraHeaders = {};
try {
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  for (const rule of vercel.headers || []) {
    if (rule.source === "/(.*)") for (const h of rule.headers) extraHeaders[h.key] = h.value;
  }
} catch {
  extraHeaders = {};
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Map a URL pathname to a file inside dist, or a status code. */
export async function resolvePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\0")) return { status: 400 };
  const target = path.resolve(DIST, `.${decoded}`);
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return { status: 403 };
  if (await isFile(target)) return { file: target };
  if (await isDir(target)) {
    const index = path.join(target, "index.html");
    if (await isFile(index)) return { file: index };
  }
  if (!path.extname(target) && (await isFile(`${target}.html`))) return { file: `${target}.html` };
  return { status: 404 };
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${HOST}`);
  const r = await resolvePath(pathname);
  const headers = { "Cache-Control": "no-store", ...extraHeaders };
  if (!r.file) {
    res.writeHead(r.status, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    res.end(`${r.status}\n`);
    return;
  }
  try {
    const body = await readFile(r.file);
    res.writeHead(200, { ...headers, "Content-Type": MIME[path.extname(r.file)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500, headers);
    res.end("500\n");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`github.fetch serving dist/ at http://${HOST}:${PORT}/`);
});
