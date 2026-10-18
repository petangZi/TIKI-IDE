// src/security/audit.mjs
// Append-only audit trail for user/agent/tool actions.
import { redactValue } from "./redact.mjs";

export function createAuditLog({ store, logger = console } = {}) {
  function record(entry) {
    const rec = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: entry.actor || "system",
      action: entry.action,
      target: entry.target || null,
      result: entry.result || "ok",
      meta: entry.meta ? redactValue(entry.meta) : null
    };
    try {
      const doc = store.load("audit", { version: 1, records: [] });
      doc.records.push(rec);
      if (doc.records.length > 5000) doc.records = doc.records.slice(-5000);
      store.saveSoon("audit", doc, 500);
    } catch (error) {
      logger.warn?.("audit write failed", { error: error.message });
    }
    return rec;
  }
  function list({ limit = 200 } = {}) {
    return store.load("audit", { version: 1, records: [] }).records.slice(-limit).reverse();
  }
  return { record, list };
}
