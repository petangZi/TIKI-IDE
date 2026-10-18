// src/subagents/registry.mjs
// Persistent typed sub-agent records: role, adapter, model, limits, depth.
export function createSubagentRegistry({ store, adapters, logger = console } = {}) {
  const docName = "subagents";
  const ROLES = ["general", "planner", "worker", "reviewer", "tester"];

  function read() {
    const d = store.load(docName, { version: 1, subagents: [] });
    if (!Array.isArray(d.subagents)) d.subagents = [];
    return d;
  }
  function write(d) { return store.save(docName, d); }

  function validate(input) {
    if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("Sub-agent name is required");
    const adapterId = input.adapter || input.agent || "opencode";
    if (!adapters.get(adapterId)) throw new Error(`Unsupported adapter: ${adapterId}`);
    return {
      id: input.id || crypto.randomUUID(),
      name: input.name.trim().slice(0, 80),
      role: ROLES.includes(input.role) ? input.role : "general",
      adapter: adapterId,
      model: input.model ? String(input.model).slice(0, 80) : null,
      enabled: input.enabled !== false,
      limits: {
        max_concurrency: clampInt(input.max_concurrency, 1, 1, 8),
        max_delegation_depth: clampInt(input.max_delegation_depth, 1, 0, 5),
        timeout_ms: clampInt(input.timeout_ms, 300_000, 1000, 3_600_000)
      },
      workspace_access: input.workspace_access === "read-write" ? "read-write" : "read-only",
      created_at: new Date().toISOString()
    };
  }

  function list() { return read().subagents; }
  function get(id) { return read().subagents.find((s) => s.id === id) || null; }
  function add(input) {
    const d = read();
    const item = validate(input);
    d.subagents.push(item);
    write(d);
    return item;
  }
  function update(id, patch) {
    const d = read();
    const found = d.subagents.find((s) => s.id === id);
    if (!found) throw new Error("Sub-agent not found");
    if (patch.enabled !== undefined) found.enabled = !!patch.enabled;
    if (patch.name) found.name = String(patch.name).slice(0, 80);
    if (patch.role && ROLES.includes(patch.role)) found.role = patch.role;
    if (patch.model !== undefined) found.model = patch.model ? String(patch.model).slice(0, 80) : null;
    write(d);
    return found;
  }
  function remove(id) {
    const d = read();
    const next = d.subagents.filter((s) => s.id !== id);
    if (next.length === d.subagents.length) throw new Error("Sub-agent not found");
    d.subagents = next;
    write(d);
    return next;
  }
  return { list, get, add, update, remove, roles: ROLES };
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
