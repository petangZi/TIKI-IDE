// src/tools/providers/mock.mjs
// Offline deterministic provider for testing the tool pipeline end-to-end.
export const mockProvider = {
  id: "mock.echo",
  version: "1.0.0",
  label: "Mock Echo",
  category: "mock",
  description: "Returns the supplied value unchanged. Offline; no network.",
  permissions: { network: [], write: false },
  timeoutMs: 2000,
  inputSchema: {
    type: "object",
    required: ["value"],
    properties: { value: { type: "string", maxLength: 500 } }
  },
  outputSchema: { type: "object", properties: { echoed: { type: "string" } } },
  async run(args) {
    return { data: { echoed: args.value }, meta: { source: "mock", timestamp: new Date().toISOString(), license: "n/a" } };
  }
};
