// src/storage/runs.mjs
// Run registry persisted on top of the generic store.
const MAX_RUNS = 500;

export function createRunStore(store, { logger = console } = {}) {
  const docName = "runs";

  function all() {
    const data = store.load(docName, { version: 1, runs: [] });
    if (!Array.isArray(data.runs)) data.runs = [];
    return data;
  }

  function persist(data) {
    if (data.runs.length > MAX_RUNS) data.runs = data.runs.slice(-MAX_RUNS);
    return store.saveSoon(docName, data);
  }

  function create(record) {
    const data = all();
    const run = {
      id: record.id || crypto.randomUUID(),
      parent_run_id: record.parentRunId || null,
      session_id: record.sessionId || null,
      agent_id: record.agentId || null,
      adapter_id: record.adapterId || null,
      prompt: record.prompt || "",
      prompt_version: record.promptVersion || null,
      status: record.status || "queued",
      workspace: record.workspace || null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      error: null,
      usage: null,
      cost: null,
      tasks: record.tasks || []
    };
    data.runs.push(run);
    persist(data);
    return run;
  }

  function update(id, patch) {
    const data = all();
    const run = data.runs.find((r) => r.id === id);
    if (!run) return null;
    Object.assign(run, patch, { updated_at: new Date().toISOString() });
    persist(data);
    return run;
  }

  function get(id) {
    return all().runs.find((r) => r.id === id) || null;
  }

  function list({ limit = 100, status = null } = {}) {
    let runs = all().runs;
    if (status) runs = runs.filter((r) => r.status === status);
    return runs.slice(-limit).reverse();
  }

  return { create, update, get, list, all: () => all().runs };
}
