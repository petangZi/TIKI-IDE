// src/workspace/snapshot.mjs
// Filesystem snapshots + change detection for verifiable live diff.
// The persisted snapshot is a hash index; file contents are cached in memory
// for the lifetime of a run so before/after diffs need no repo duplication.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { unifiedDiff } from "./diff.mjs";

const SNAP_IGNORE = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".tiki", ".tiki-data", "coverage", ".cache"]);

function hashBuf(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function createSnapshotManager({ workspace, store = null, maxFileBytes = 1_000_000, maxFiles = 20_000 } = {}) {
  const ROOT = workspace.root;

  function scan() {
    const files = new Map(); // relPath -> {hash,size,binary}
    const walk = (dir, d) => {
      if (d > 8 || files.size >= maxFiles) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (files.size >= maxFiles) return;
        if (SNAP_IGNORE.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        let st; try { st = fs.lstatSync(abs); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { walk(abs, d + 1); continue; }
        if (st.size > maxFileBytes) continue;
        let buf; try { buf = fs.readFileSync(abs); } catch { continue; }
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        files.set(rel, { hash: hashBuf(buf), size: st.size, binary: isBinary(buf) });
      }
    };
    walk(ROOT, 0);
    return files;
  }

  /**
   * Capture a snapshot. Contents are cached in memory (capped) for later diffing.
   * The persisted record is index-only.
   */
  function capture({ label = null, cacheContents = true, contentCap = 400 } = {}) {
    const index = scan();
    const id = crypto.randomUUID();
    const contents = new Map();
    if (cacheContents) {
      let cached = 0;
      for (const [rel, info] of index) {
        if (cached >= contentCap || info.binary) continue;
        try { contents.set(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")); cached++; } catch {}
      }
    }
    const snapshot = {
      id,
      label,
      created_at: new Date().toISOString(),
      file_count: index.size,
      files: Object.fromEntries([...index].map(([k, v]) => [k, { hash: v.hash, size: v.size, binary: v.binary ? 1 : 0 }])),
      contents // non-serialisable, in-memory only
    };
    if (store) {
      const doc = store.load("snapshots", { version: 1, snapshots: [] });
      doc.snapshots.push({ id, label, created_at: snapshot.created_at, file_count: index.size });
      if (doc.snapshots.length > 100) doc.snapshots = doc.snapshots.slice(-100);
      store.saveSoon("snapshots", doc);
    }
    return snapshot;
  }

  function compare(before, afterIndex) {
    const added = [];
    const removed = [];
    const modified = [];
    for (const [rel, info] of afterIndex) {
      const prev = before.files[rel];
      if (!prev) added.push(rel);
      else if (prev.hash !== info.hash) modified.push(rel);
    }
    for (const rel of Object.keys(before.files)) if (!afterIndex.has(rel)) removed.push(rel);
    return { added, removed, modified };
  }

  /** Re-scan disk and build a full diff report against a baseline snapshot. */
  function diffAgainst(before, { maxDiffs = 200, context = 3 } = {}) {
    const index = scan();
    const changes = compare(before, index);
    const files = [];
    for (const rel of changes.added) {
      let after = "";
      try { after = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch {}
      files.push({ path: rel, status: "added", ...safeDiff("", after, rel, context) });
    }
    for (const rel of changes.modified) {
      const before_text = before.contents?.get(rel);
      if (before_text === undefined) { files.push({ path: rel, status: "modified", binary: true, additions: 0, deletions: 0, hunks: [] }); continue; }
      let after = "";
      try { after = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch {}
      files.push({ path: rel, status: "modified", ...safeDiff(before_text, after, rel, context) });
    }
    for (const rel of changes.removed) {
      const before_text = before.contents?.get(rel) ?? "";
      files.push({ path: rel, status: "deleted", ...safeDiff(before_text, "", rel, context) });
    }
    const totals = files.reduce((acc, f) => ({ additions: acc.additions + (f.additions || 0), deletions: acc.deletions + (f.deletions || 0) }), { additions: 0, deletions: 0 });
    return {
      snapshot_id: before.id,
      generated_at: new Date().toISOString(),
      counts: { added: changes.added.length, modified: changes.modified.length, deleted: changes.removed.length },
      additions: totals.additions,
      deletions: totals.deletions,
      files: files.slice(0, maxDiffs),
      truncated: files.length > maxDiffs
    };
  }

  function safeDiff(a, b, rel, context) {
    const d = unifiedDiff(a, b, { context, pathA: `a/${rel}`, pathB: `b/${rel}` });
    return { additions: d.additions, deletions: d.deletions, hunks: d.hunks, diff: d.text, binary: false };
  }

  return { capture, compare, diffAgainst, scan };
}
