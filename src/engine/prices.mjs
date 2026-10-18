// src/engine/prices.mjs
// Versioned price catalog. Example rates are reference snapshots (roadmap §8.6),
// not live guarantees. Each entry records source + effective date + version.
export const DEFAULT_MARKUP = 1.7;

// Reference snapshot taken 2026-10-18 from official pricing pages.
const SEED = [
  { provider: "openai", model_id: "gpt-6.1-sol", input_per_million: 1.00, output_per_million: 5.00, cached_input_per_million: 0.50, currency: "USD", source_url: "https://developers.openai.com/api/docs/pricing" },
  { provider: "anthropic", model_id: "claude-sonnet-5.5", input_per_million: 2.00, output_per_million: 10.00, cached_input_per_million: 0.20, currency: "USD", source_url: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { provider: "anthropic", model_id: "claude-haiku-5.5", input_per_million: 0.10, output_per_million: 0.50, cached_input_per_million: 0.01, currency: "USD", source_url: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { provider: "deepseek", model_id: "deepseek-chat-offpeak", input_per_million: 0.15, output_per_million: 0.66, cached_input_per_million: 0.075, currency: "USD", source_url: "https://api-docs.deepseek.com/quick_start/pricing/" },
  { provider: "deepseek", model_id: "deepseek-chat-peak", input_per_million: 0.30, output_per_million: 1.32, cached_input_per_million: 0.15, currency: "USD", source_url: "https://api-docs.deepseek.com/quick_start/pricing/" },
  // Local/free adapters carry zero provider cost.
  { provider: "local", model_id: "*", input_per_million: 0, output_per_million: 0, cached_input_per_million: 0, currency: "USD", source_url: null }
];

export function createPriceCatalog({ store, markup = DEFAULT_MARKUP, logger = console } = {}) {
  function read() {
    const d = store.load("prices", { version: 1, markup, entries: SEED });
    if (!Array.isArray(d.entries) || d.entries.length === 0) { d.entries = SEED; store.save("prices", d); }
    return d;
  }

  function list() { return read().entries; }

  function lookup(provider, modelId) {
    const entries = read().entries.filter((e) => e.provider === provider);
    return entries.find((e) => e.model_id === modelId) || entries.find((e) => e.model_id === "*") || null;
  }

  function priceVersion(entry) {
    return entry ? `${entry.provider}/${entry.model_id}@${entry.effective_date || "seed"}` : "unknown";
  }

  /**
   * Compute provider cost from a usage record. Cached input tokens are treated
   * as a subset of input tokens (OpenAI semantics) so they are not double-charged.
   */
  function computeCost({ provider, model, usage, currency = "USD" }) {
    const entry = lookup(provider, model);
    if (!entry || !usage) return { provider_cost: 0, user_charge: 0, currency, price_version: "unpriced", breakdown: null };
    const input = Number(usage.input_tokens) || 0;
    const output = Number(usage.output_tokens) || 0;
    const cached = Math.min(Number(usage.cached_input_tokens) || 0, input);
    const uncached = Math.max(0, input - cached);
    const M = 1_000_000;
    const inputCost = (uncached / M) * entry.input_per_million;
    const cachedCost = (cached / M) * entry.cached_input_per_million;
    const outputCost = (output / M) * entry.output_per_million;
    const providerCost = inputCost + cachedCost + outputCost;
    const charge = providerCost * markup; // customer-facing managed rate
    return {
      provider_cost: round(providerCost),
      user_charge: round(charge),
      currency: entry.currency || currency,
      price_version: priceVersion(entry),
      breakdown: { input_uncached: uncached, input_cached: cached, output, input_cost: round(inputCost), cached_cost: round(cachedCost), output_cost: round(outputCost), markup }
    };
  }

  function setMarkup(next) {
    const d = read();
    d.markup = Number(next) > 0 ? Number(next) : DEFAULT_MARKUP;
    store.save("prices", d);
    return d.markup;
  }

  function upsert(entry) {
    const d = read();
    const idx = d.entries.findIndex((e) => e.provider === entry.provider && e.model_id === entry.model_id);
    const record = { ...entry, effective_date: entry.effective_date || new Date().toISOString().slice(0, 10) };
    if (idx >= 0) d.entries[idx] = record; else d.entries.push(record);
    store.save("prices", d);
    return record;
  }

  return { list, lookup, computeCost, setMarkup, upsert, markup: () => read().markup };
}

function round(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }
