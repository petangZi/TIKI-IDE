// src/tools/schema.mjs
// Tiny JSON-schema subset validator (type, required, enum, bounds). Enough for
// tool input validation without pulling in a dependency.
export function validateSchema(schema, value, path = "$") {
  const errors = [];
  if (!schema) return errors;
  const type = schema.type;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (type && actual !== type && !(type === "integer" && actual === "number")) {
    errors.push(`${path}: expected ${type}, got ${actual}`);
    return errors;
  }
  if (type === "object") {
    for (const req of schema.required || []) {
      if (value?.[req] === undefined || value?.[req] === null) errors.push(`${path}.${req}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value && value[key] !== undefined && value[key] !== null) errors.push(...validateSchema(sub, value[key], `${path}.${key}`));
    }
  }
  if (type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((v, i) => errors.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  if (schema.maxLength !== undefined && typeof value === "string" && value.length > schema.maxLength) errors.push(`${path}: exceeds maxLength ${schema.maxLength}`);
  return errors;
}
