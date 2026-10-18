// src/storage/store.mjs
// Dependency-free durable storage:
//   - JSON documents (runs, usage, settings) with atomic write-then-rename
//   - append-only JSONL event log with in-memory tail index for fast replay
import fs from "node:fs";
import path from "node:path";

const MAX_EVENT_LINES = 100_000; // rotate/trim guard for the JSONL log

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    return fallback;
  }
}

export function createStore({ dataDir }) {
  ensureDir(dataDir);
  const docPath = (name) => path.join(dataDir, `${name}.json`);
  const eventsPath = path.join(dataDir, "events.jsonl");
  const docs = new Map(); // name -> {data, dirty, timer}

  // --- JSON documents ---
  function load(name, fallback) {
    if (!docs.has(name)) docs.set(name, { data: readJson(docPath(name), fallback), timer: null });
    return docs.get(name).data;
  }

  function save(name, data) {
    const entry = docs.get(name) || { data, timer: null };
    entry.data = data;
    docs.set(name, entry);
    atomicWrite(docPath(name), JSON.stringify(data, null, 2));
    return data;
  }

  // Debounced save for hot paths (usage ledger writes).
  function saveSoon(name, data, delayMs = 250) {
    const entry = docs.get(name) || { data, timer: null };
    entry.data = data;
    docs.set(name, entry);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      try { atomicWrite(docPath(name), JSON.stringify(entry.data, null, 2)); }
      catch { /* best effort */ }
      entry.timer = null;
    }, delayMs);
    return data;
  }

  function flush() {
    for (const [name, entry] of docs) {
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
      try { atomicWrite(docPath(name), JSON.stringify(entry.data, null, 2)); } catch {}
    }
  }

  // --- Event log (append-only) ---
  let seqIndex = null; // lazily built array of events

  function appendEvent(envelope) {
    fs.appendFileSync(eventsPath, JSON.stringify(envelope) + "\n", { mode: 0o600 });
    if (seqIndex) seqIndex.push(envelope);
    return envelope;
  }

  function readAllEvents() {
    if (seqIndex) return seqIndex;
    seqIndex = [];
    try {
      const raw = fs.readFileSync(eventsPath, "utf8");
      const lines = raw.split("\n");
      const start = Math.max(0, lines.length - MAX_EVENT_LINES);
      for (let i = start; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try { seqIndex.push(JSON.parse(line)); } catch {}
      }
    } catch { /* no log yet */ }
    return seqIndex;
  }

  function listEvents({ limit = 500, order = "asc", runId = null, type = null, since = null } = {}) {
    let all = readAllEvents();
    if (runId) all = all.filter((e) => e.run_id === runId);
    if (type) all = all.filter((e) => e.type === type);
    if (since) { const t = Date.parse(since); if (Number.isFinite(t)) all = all.filter((e) => Date.parse(e.timestamp) >= t); }
    const slice = order === "desc" ? all.slice(-limit).reverse() : all.slice(-limit);
    return slice;
  }

  function countEvents() {
    return readAllEvents().length;
  }

  function close() {
    flush();
  }

  return { load, save, saveSoon, flush, appendEvent, listEvents, countEvents, close, dataDir, docPath, eventsPath };
}
