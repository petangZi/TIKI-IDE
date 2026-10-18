#!/usr/bin/env node
// scripts/build-public-apis.mjs
// Parses the public-apis repository index (README markdown tables) into a
// local JSON catalog the tool runtime can search and call. Run whenever the
// upstream list should be refreshed:
//
//   node scripts/build-public-apis.mjs [path-to-README.md]
//
// With no path it fetches the upstream README from GitHub.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "src", "tools", "public-apis", "catalog.json");

const UPSTREAM = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md";
const TABLE_HEADER = /^\|?\s*API\s*\|\s*Description\s*\|\s*Auth\s*\|\s*HTTPS\s*\|\s*CORS\s*\|?\s*$/;
const HEADING = /^###\s+(.+?)\s*$/;
const ROW = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.*)\|\s*$/;

function slug(name, seen) {
  const base = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "api";
  let id = base;
  let n = 2;
  while (seen.has(id)) id = `${base}-${n++}`;
  seen.add(id);
  return id;
}

function cleanLink(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|fbclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function hostOf(link) {
  try { return new URL(link).hostname.toLowerCase(); } catch { return null; }
}

export function parseCatalog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const seen = new Set();
  const entries = [];
  let heading = null;
  let inTable = false;

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) { heading = h[1].trim(); inTable = false; continue; }
    if (TABLE_HEADER.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith("|")) { inTable = false; continue; }
    if (/^\|[\s:-]+\|/.test(line)) continue; // separator row

    const m = ROW.exec(line);
    if (!m) continue;
    const [, name, rawLink, rest] = m;
    const cols = rest.split("|").map((c) => c.trim());
    if (cols.length < 4) continue;

    const [description, authRaw, httpsRaw, corsRaw] = cols;
    const link = cleanLink(rawLink);
    const host = hostOf(link);
    if (!host) continue;

    const auth = authRaw.replace(/`/g, "").trim() || "No";
    const https = /^yes$/i.test(httpsRaw);
    const cors = corsRaw.replace(/[*_`]/g, "").trim() || "Unknown";

    entries.push({
      id: slug(name, seen),
      name,
      description,
      category: heading || "Uncategorized",
      auth,
      https,
      cors,
      host,
      link
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

async function readSource(argPath) {
  if (argPath) return fs.readFileSync(path.resolve(argPath), "utf8");
  const res = await fetch(UPSTREAM);
  if (!res.ok) throw new Error(`Failed to fetch upstream README: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const argPath = process.argv[2];
  const markdown = await readSource(argPath);
  const entries = parseCatalog(markdown);
  if (entries.length < 100) throw new Error(`Catalog looks too small (${entries.length}); parser or source changed.`);

  const byCategory = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

  const payload = {
    source: "https://github.com/public-apis/public-apis",
    generated_at: new Date().toISOString(),
    count: entries.length,
    categories: Object.keys(byCategory).sort(),
    entries
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1) + "\n");
  process.stdout.write(`public-apis catalog: ${entries.length} entries, ${Object.keys(byCategory).length} categories -> ${path.relative(ROOT, OUT)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`build-public-apis failed: ${error.stack || error.message}\n`); process.exit(1); });
}
