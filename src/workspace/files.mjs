// src/workspace/files.mjs
// Path-safe workspace filesystem operations. All access is confined to the
// workspace root; traversal and symlink escapes are rejected server-side.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_IGNORE = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".tiki", ".tiki-data", "coverage", ".cache"]);
const BINARY_PROBE = 8000;

export class WorkspaceError extends Error {
  constructor(message, code = "WORKSPACE_ERROR", status = 400) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.status = status;
  }
}

export function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function createWorkspace({ root, maxFileBytes = 1_000_000, ignore = DEFAULT_IGNORE } = {}) {
  const ROOT = fs.realpathSync(path.resolve(root));

  function guard(input = ".") {
    const candidate = path.resolve(ROOT, String(input));
    if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) {
      throw new WorkspaceError("Path escapes the workspace", "PATH_ESCAPE", 403);
    }
    // Walk up to the nearest existing ancestor and confirm it does not symlink out.
    let existing = candidate;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    let realExisting;
    try { realExisting = fs.realpathSync(existing); } catch { throw new WorkspaceError("Path cannot be resolved", "PATH_INVALID", 400); }
    if (realExisting !== ROOT && !realExisting.startsWith(ROOT + path.sep)) {
      throw new WorkspaceError("Symlink escapes the workspace", "SYMLINK_ESCAPE", 403);
    }
    return candidate;
  }

  function rel(abs) {
    return path.relative(ROOT, abs).split(path.sep).join("/") || ".";
  }

  function stat(input) {
    const abs = guard(input);
    if (!fs.existsSync(abs)) throw new WorkspaceError("Not found", "NOT_FOUND", 404);
    const s = fs.lstatSync(abs);
    return { path: rel(abs), type: s.isDirectory() ? "dir" : "file", size: s.size, mtime: s.mtimeMs, symlink: s.isSymbolicLink() };
  }

  function listTree(input = ".", { depth = 6, limit = 4000, includeIgnored = false } = {}) {
    const abs = guard(input);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new WorkspaceError("Folder not found", "NOT_FOUND", 404);
    const out = [];
    const walk = (dir, d) => {
      if (d > depth || out.length >= limit) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (!includeIgnored && ignore.has(e.name)) continue;
        const childAbs = path.join(dir, e.name);
        let s; try { s = fs.lstatSync(childAbs); } catch { continue; }
        if (s.isSymbolicLink()) continue;
        out.push({ name: e.name, path: rel(childAbs), type: s.isDirectory() ? "dir" : "file", size: s.isDirectory() ? 0 : s.size });
        if (s.isDirectory()) walk(childAbs, d + 1);
        if (out.length >= limit) return;
      }
    };
    walk(abs, 0);
    return { root: ROOT, path: rel(abs), entries: out };
  }

  function isProbablyBinary(buf) {
    const n = Math.min(buf.length, BINARY_PROBE);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  }

  function readFile(input) {
    const abs = guard(input);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new WorkspaceError("File not found", "NOT_FOUND", 404);
    const stat0 = fs.statSync(abs);
    if (stat0.size > maxFileBytes) throw new WorkspaceError(`File too large to read (limit ${maxFileBytes} bytes)`, "TOO_LARGE", 413);
    const buf = fs.readFileSync(abs);
    const binary = isProbablyBinary(buf);
    return { path: rel(abs), size: stat0.size, binary, hash: hashText(buf.toString("utf8")), content: binary ? null : buf.toString("utf8") };
  }

  function writeFile(input, content, { expectHash = null, create = false } = {}) {
    if (typeof content !== "string") throw new WorkspaceError("content must be a string", "BAD_INPUT", 400);
    if (Buffer.byteLength(content) > maxFileBytes) throw new WorkspaceError(`File exceeds ${maxFileBytes} byte limit`, "TOO_LARGE", 413);
    const abs = guard(input);
    const exists = fs.existsSync(abs);
    if (!exists && !create) throw new WorkspaceError("File does not exist (create not requested)", "NOT_FOUND", 404);
    if (exists && fs.statSync(abs).isDirectory()) throw new WorkspaceError("Cannot write to a directory", "IS_DIR", 400);
    // Conflict detection: refuse silent overwrite when caller supplies a stale hash.
    if (exists && expectHash) {
      const current = hashText(fs.readFileSync(abs, "utf8"));
      if (current !== expectHash) throw new WorkspaceError("File changed on disk since it was read", "CONFLICT", 409);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existed = exists;
    fs.writeFileSync(abs, content, { encoding: "utf8", mode: 0o644 });
    return { path: rel(abs), created: !existed, hash: hashText(content), size: Buffer.byteLength(content) };
  }

  function createDir(input) {
    const abs = guard(input);
    fs.mkdirSync(abs, { recursive: true });
    return { path: rel(abs), type: "dir" };
  }

  function remove(input) {
    const abs = guard(input);
    if (abs === ROOT) throw new WorkspaceError("Refusing to delete the workspace root", "FORBIDDEN", 403);
    if (!fs.existsSync(abs)) throw new WorkspaceError("Not found", "NOT_FOUND", 404);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
    else fs.unlinkSync(abs);
    return { path: rel(abs), removed: true };
  }

  function rename(from, to) {
    const absFrom = guard(from);
    const absTo = guard(to);
    if (!fs.existsSync(absFrom)) throw new WorkspaceError("Source not found", "NOT_FOUND", 404);
    if (fs.existsSync(absTo)) throw new WorkspaceError("Destination already exists", "CONFLICT", 409);
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    fs.renameSync(absFrom, absTo);
    return { from: rel(absFrom), to: rel(absTo) };
  }

  function search(query, { maxResults = 200, caseSensitive = false } = {}) {
    if (!query) throw new WorkspaceError("query is required", "BAD_INPUT", 400);
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    const walk = (dir, d) => {
      if (d > 6 || matches.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (matches.length >= maxResults) return;
        if (ignore.has(e.name)) continue;
        const childAbs = path.join(dir, e.name);
        let s; try { s = fs.lstatSync(childAbs); } catch { continue; }
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) { walk(childAbs, d + 1); continue; }
        if (s.size > maxFileBytes) continue;
        let buf; try { buf = fs.readFileSync(childAbs); } catch { continue; }
        if (isProbablyBinary(buf)) continue;
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (hay.includes(needle)) matches.push({ path: rel(childAbs), line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
    };
    walk(ROOT, 0);
    return { query, matches };
  }

  return { root: ROOT, guard, rel, stat, listTree, readFile, writeFile, createDir, remove, rename, search };
}
