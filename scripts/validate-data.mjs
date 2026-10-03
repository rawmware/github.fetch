#!/usr/bin/env node
// Validate a repos.json snapshot (§3.4). Usage: node scripts/validate-data.mjs [path]
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSnapshot } from "./lib/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 1.5 * 1024 * 1024;
const MIN_REPOS = 20;

const file = path.resolve(process.cwd(), process.argv[2] || path.join(ROOT, "dist/data/repos.json"));
const errors = [];
let snap = null;
let size = 0;

try {
  size = (await stat(file)).size;
  snap = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
  errors.push(`cannot read ${file}: ${err.message}`);
}

if (snap) {
  const v = validateSnapshot(snap);
  errors.push(...v.errors);
  if (size >= MAX_BYTES) errors.push(`file is ${size} bytes (limit ${MAX_BYTES})`);
  if (!Array.isArray(snap.repos) || snap.repos.length < MIN_REPOS) {
    errors.push(`repos.length must be >= ${MIN_REPOS} (has ${Array.isArray(snap.repos) ? snap.repos.length : 0})`);
  }
}

const rel = path.relative(process.cwd(), file) || file;
if (errors.length) {
  console.error(`✗ ${rel} is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
  process.exit(1);
}

const s = snap.stats;
console.log(`✓ ${rel} is valid`);
console.log(`  mode ${snap.source?.mode ?? "?"} · generatedAt ${snap.generatedAt} · snapshotAt ${snap.snapshotAt}`);
console.log(`  ${s.total} repos · ${s.withOneLiner} with a one-liner · ${s.languages} languages · ${(size / 1024).toFixed(1)} KB`);
console.log(`  byMethod ${JSON.stringify(s.byMethod)}`);
if (snap.source?.warnings?.length) console.log(`  warnings: ${snap.source.warnings.join(" | ")}`);
