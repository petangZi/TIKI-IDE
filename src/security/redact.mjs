// src/security/redact.mjs
// Secret redaction for logs, events, audit records, and exports.
const PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(ghp_[A-Za-z0-9]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{16,})\b/gi,
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g
];

const KEY_HINTS = /(api[_-]?key|secret|password|passwd|token|authorization|private[_-]?key|client[_-]?secret)/i;

export function redactString(input) {
  if (typeof input !== "string") return input;
  let out = input;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function redactValue(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (KEY_HINTS.test(k) && typeof v === "string" && v.length > 0) out[k] = "[REDACTED]";
      else out[k] = redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactForDisplay(value) {
  return redactValue(value);
}
