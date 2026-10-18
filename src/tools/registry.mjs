// src/tools/registry.mjs
// Non-AI tool runtime. Validates inputs/outputs, enforces timeouts, records
// provenance, and never executes arbitrary user code.
import { validateSchema } from "./schema.mjs";
import { mockProvider } from "./providers/mock.mjs";
import { weatherProvider } from "./providers/weather.mjs";
import { createHttpProvider } from "./providers/http.mjs";

export function createToolRegistry({ config, logger = console, audit = null } = {}) {
  const tools = new Map();

  function register(tool) {
    if (!tool?.id || typeof tool.run !== "function") throw new Error("Tool must have id and run()");
    tools.set(tool.id, tool);
    return tool;
  }

  register(mockProvider);
  register(weatherProvider);
  register(createHttpProvider({ allowlist: config.toolHttpAllowlist }));

  function get(id) { return tools.get(id) || null; }

  function toDescriptor(tool) {
    return {
      id: tool.id, version: tool.version, label: tool.label, category: tool.category,
      description: tool.description, permissions: tool.permissions, timeoutMs: tool.timeoutMs,
      inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
      network: (tool.permissions?.network || []).length > 0
    };
  }

  function list() { return [...tools.values()].map(toDescriptor); }

  function catalog() {
    const byCategory = {};
    for (const t of tools.values()) {
      const c = t.category || "general";
      (byCategory[c] ||= []).push(toDescriptor(t));
    }
    return Object.entries(byCategory).map(([id, items]) => ({
      id,
      label: id.replace(/(^|-)(\w)/g, (_, a, b) => (a ? " " : "") + b.toUpperCase()).trim(),
      status: "available",
      tools: items.map((i) => i.id)
    }));
  }

  async function invoke(id, args = {}, { actor = "system" } = {}) {
    const tool = get(id);
    if (!tool) { const e = new Error(`Unknown tool: ${id}`); e.status = 404; throw e; }
    const inputErrors = validateSchema(tool.inputSchema, args || {});
    if (inputErrors.length) { const e = new Error(`Invalid tool input: ${inputErrors.join("; ")}`); e.status = 400; e.code = "TOOL_INPUT_INVALID"; throw e; }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), tool.timeoutMs || 10_000);
    try {
      const result = await Promise.race([
        tool.run(args, { signal: controller.signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tool timed out")), (tool.timeoutMs || 10_000) + 250))
      ]);
      clearTimeout(timer);
      const outputErrors = validateSchema(tool.outputSchema, result.data);
      if (outputErrors.length) logger.warn?.("tool output failed schema", { tool: id, errors: outputErrors });
      const record = {
        tool: id, version: tool.version, duration_ms: Date.now() - started,
        ok: true, provenance: result.meta || null, output_schema_ok: outputErrors.length === 0
      };
      audit?.record?.({ actor, action: "tool.invoke", target: id, result: "ok", meta: { duration_ms: record.duration_ms } });
      return { ...record, data: result.data };
    } catch (error) {
      clearTimeout(timer);
      audit?.record?.({ actor, action: "tool.invoke", target: id, result: "error", meta: { error: error.message } });
      const e = new Error(error.message);
      e.status = error.status || 502;
      e.code = error.code || "TOOL_ERROR";
      throw e;
    }
  }

  return { register, get, list, catalog, invoke, tools };
}
