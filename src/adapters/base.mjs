// src/adapters/base.mjs
// Adapter contract. Every adapter exposes a capability manifest, a bounded
// detect() health probe, and a run() that streams normalised activity through
// the onEvent callback using canonical event types.

export const CAPABILITIES = Object.freeze([
  "streaming", "tools", "terminal", "fileAccess", "cancellation", "usageReporting", "resume"
]);

export function emptyCapabilities(overrides = {}) {
  return Object.fromEntries(CAPABILITIES.map((c) => [c, Boolean(overrides[c])]));
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pick = (...keys) => {
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) return Number(raw[k]);
    return undefined;
  };
  const usage = {
    input_tokens: pick("prompt_tokens", "input_tokens", "inputTokens"),
    output_tokens: pick("completion_tokens", "output_tokens", "outputTokens"),
    cached_input_tokens: pick("cached_tokens", "cache_read_input_tokens", "cachedInputTokens"),
    reasoning_tokens: pick("reasoning_tokens", "reasoningTokens")
  };
  const any = Object.values(usage).some((v) => Number.isFinite(v) && v > 0);
  return any ? usage : null;
}

/** Wrap a raw adapter definition with validation + default capability merge. */
export function defineAdapter(def) {
  for (const field of ["id", "name", "detect", "run"]) {
    if (!def[field]) throw new Error(`Adapter missing required field: ${field}`);
  }
  return {
    kind: "generic",
    capabilities: emptyCapabilities(),
    ...def,
    capabilities: emptyCapabilities(def.capabilities || {})
  };
}

export class AdapterError extends Error {
  constructor(message, { code = "ADAPTER_ERROR", status = 502, adapterId = null } = {}) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.status = status;
    this.adapterId = adapterId;
  }
}
