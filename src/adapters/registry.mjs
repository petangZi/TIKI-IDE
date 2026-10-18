// src/adapters/registry.mjs
// Adapter registry + capability negotiation + conformance checks.
import { createOpenCodeAdapter } from "./opencode.mjs";
import { createOpenAICompatibleAdapter } from "./openai-compatible.mjs";
import { createMockAdapter } from "./mock.mjs";
import { CAPABILITIES } from "./base.mjs";

export function createAdapterRegistry({ config, logger = console } = {}) {
  const adapters = new Map();

  function register(adapter) {
    adapters.set(adapter.id, adapter);
    return adapter;
  }

  // Built-in adapters, all overridable by adding another with the same id.
  register(createOpenCodeAdapter({ url: config.agents.opencode.url }));
  register(createOpenAICompatibleAdapter({ id: "hermes", name: "Hermes", url: config.agents.hermes.url, apiKey: config.agents.hermes.apiKey, model: config.agents.hermes.model }));
  register(createOpenAICompatibleAdapter({ id: "openclaw", name: "OpenClaw", url: config.agents.openclaw.url, apiKey: config.agents.openclaw.apiKey, model: config.agents.openclaw.model }));
  register(createMockAdapter());

  function get(id) {
    return adapters.get(id) || null;
  }

  function require_(id) {
    const a = get(id);
    if (!a) { const err = new Error(`Unknown adapter: ${id}`); err.status = 400; err.code = "ADAPTER_UNKNOWN"; throw err; }
    return a;
  }

  function list() {
    return [...adapters.values()].map((a) => ({ id: a.id, name: a.name, kind: a.kind, capabilities: a.capabilities }));
  }

  async function detectAll() {
    const results = await Promise.all([...adapters.values()].map(async (a) => {
      let res;
      try { res = await a.detect(); } catch (error) { res = { detected: false, detail: error.message }; }
      return { id: a.id, name: a.name, kind: a.kind, capabilities: a.capabilities, ...res };
    }));
    return results;
  }

  async function detect(id) {
    const a = require_(id);
    try { return { id, ...(await a.detect()) }; } catch (error) { return { id, detected: false, detail: error.message }; }
  }

  /**
   * Conformance check: every adapter must expose the contract surface and
   * report a complete capability manifest. Used by tests and diagnostics.
   */
  function conform(adapter) {
    const problems = [];
    if (typeof adapter.id !== "string" || !adapter.id) problems.push("missing id");
    if (typeof adapter.name !== "string" || !adapter.name) problems.push("missing name");
    if (typeof adapter.detect !== "function") problems.push("missing detect()");
    if (typeof adapter.run !== "function") problems.push("missing run()");
    for (const cap of CAPABILITIES) if (typeof adapter.capabilities?.[cap] !== "boolean") problems.push(`capability ${cap} not boolean`);
    return { ok: problems.length === 0, id: adapter.id, problems };
  }

  function conformAll() {
    return [...adapters.values()].map(conform);
  }

  return { register, get, require: require_, list, detectAll, detect, conform, conformAll, adapters };
}
