// src/engine/cost.mjs
// Usage ledger. Stores raw provider usage and the calculated cost separately so
// estimates can be reconciled against provider invoices later.
const MAX_RECORDS = 10_000;

export function createUsageLedger({ store, prices, logger = console } = {}) {
  const docName = "usage";

  function doc() {
    const d = store.load(docName, { version: 1, records: [] });
    if (!Array.isArray(d.records)) d.records = [];
    return d;
  }

  function record({ userId = "local", workspaceId = null, runId, requestId = null, provider = "local", model = "*", usage = null, source = "provider_response", status = "final" }) {
    const cost = usage ? prices.computeCost({ provider, model, usage }) : { provider_cost: 0, user_charge: 0, currency: "USD", price_version: "unpriced" };
    const rec = {
      id: crypto.randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      run_id: runId,
      request_id: requestId,
      provider,
      model,
      price_version: cost.price_version,
      currency: cost.currency,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      cached_input_tokens: usage?.cached_input_tokens ?? null,
      reasoning_tokens: usage?.reasoning_tokens ?? null,
      provider_cost: cost.provider_cost,
      tool_cost: 0,
      infrastructure_allocation: 0,
      estimated_user_charge: cost.user_charge,
      final_user_charge: cost.user_charge,
      status,
      source,
      breakdown: cost.breakdown || null,
      created_at: new Date().toISOString(),
      reconciled_at: null
    };
    const d = doc();
    d.records.push(rec);
    if (d.records.length > MAX_RECORDS) d.records = d.records.slice(-MAX_RECORDS);
    store.saveSoon(docName, d);
    return rec;
  }

  function list({ limit = 200, runId = null } = {}) {
    let records = doc().records;
    if (runId) records = records.filter((r) => r.run_id === runId);
    return records.slice(-limit).reverse();
  }

  function summary() {
    const records = doc().records;
    const totals = records.reduce((acc, r) => ({
      runs: acc.runs + (r.run_id ? 1 : 0),
      provider_cost: acc.provider_cost + (r.provider_cost || 0),
      user_charge: acc.user_charge + (r.final_user_charge || 0),
      input_tokens: acc.input_tokens + (r.input_tokens || 0),
      output_tokens: acc.output_tokens + (r.output_tokens || 0)
    }), { runs: 0, provider_cost: 0, user_charge: 0, input_tokens: 0, output_tokens: 0 });
    return { ...totals, records: records.length, markup: prices.markup(), currency: "USD" };
  }

  return { record, list, summary };
}
