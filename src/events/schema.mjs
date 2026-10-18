// src/events/schema.mjs
// Canonical, versioned event contract. Every adapter, tool, and engine path
// emits events through this schema so the UI has one truthful source of truth.
export const SCHEMA_VERSION = "1";

// Full event type catalogue (roadmap §4). Adapters must map native events onto these.
export const EVENT_TYPES = Object.freeze([
  // run lifecycle
  "run.queued", "run.started", "run.waiting_approval", "run.completed", "run.failed", "run.cancelled",
  // agent
  "agent.status", "agent.message.delta", "agent.message.completed",
  // plan / tasks
  "plan.created", "task.created", "task.started", "task.completed", "task.blocked",
  // tools
  "tool.requested", "tool.approval_required", "tool.started", "tool.output.delta", "tool.completed", "tool.failed",
  // files
  "file.read", "file.created", "file.changed", "file.deleted", "diff.updated",
  // terminal / processes
  "terminal.started", "terminal.output", "terminal.exit",
  // test / build
  "test.started", "test.result", "build.started", "build.result",
  // usage / cost
  "usage.reported", "cost.updated",
  // connection / system
  "connection.lost", "connection.restored", "warning.created",
  // prompt traceability (roadmap §16)
  "prompt.attached", "prompt.updated",
  // operational (kept for parity with the MVP stream)
  "command.started", "command.completed", "subagent.added", "subagent.removed", "subagent.updated",
  // stream control
  "connected", "snapshot"
]);

const TYPE_SET = new Set(EVENT_TYPES);

export const VISIBILITIES = Object.freeze(["user", "internal", "diagnostic"]);

// Which types may be dropped from the durable store (high-volume deltas).
export const EPHEMERAL_TYPES = new Set(["agent.message.delta", "tool.output.delta", "terminal.output", "connected"]);

const REQUIRED = ["type"];
const MAX_PAYLOAD_BYTES = 200_000;

export class EventValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "EventValidationError";
    this.code = "EVENT_INVALID";
    this.errors = errors;
  }
}

/**
 * Validate a partial event. Fields other than `type` are filled by the bus.
 * Returns a normalised envelope fragment; throws EventValidationError on failure.
 */
export function validateEvent(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    throw new EventValidationError("Event must be an object");
  }
  for (const key of REQUIRED) {
    if (input[key] === undefined || input[key] === null) errors.push(`missing required field: ${key}`);
  }
  if (typeof input.type === "string" && !TYPE_SET.has(input.type)) {
    errors.push(`unknown event type: ${input.type}`);
  }
  if (input.visibility !== undefined && !VISIBILITIES.includes(input.visibility)) {
    errors.push(`invalid visibility: ${input.visibility}`);
  }
  if (input.sequence !== undefined && input.sequence !== null && (!Number.isInteger(input.sequence) || input.sequence < 0)) {
    errors.push("sequence must be a non-negative integer");
  }
  if (input.parent_run_id !== undefined && input.parent_run_id !== null && typeof input.parent_run_id !== "string") {
    errors.push("parent_run_id must be a string or null");
  }
  if (input.payload !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(input.payload));
    if (size > MAX_PAYLOAD_BYTES) errors.push(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  if (errors.length) throw new EventValidationError(`Invalid event: ${errors.join("; ")}`, errors);
  return true;
}

export function isKnownType(type) {
  return TYPE_SET.has(type);
}

export function isEphemeral(type) {
  return EPHEMERAL_TYPES.has(type);
}

/**
 * Build a full envelope. Caller supplies identity + type; bus supplies the rest.
 */
export function makeEnvelope({ type, runId = null, parentRunId = null, agentId = null, adapterId = null, sessionId = null, visibility = "user", payload = {}, text = null, extra = {} }) {
  const base = {
    schema_version: SCHEMA_VERSION,
    event_id: crypto.randomUUID(),
    run_id: runId,
    parent_run_id: parentRunId,
    agent_id: agentId,
    adapter_id: adapterId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    sequence: null, // assigned by bus
    type,
    visibility,
    payload
  };
  if (text !== null && text !== undefined) base.payload = { ...base.payload, text };
  const merged = { ...base, ...extra };
  // Preserve required identity fields; extra cannot clobber the contract.
  merged.schema_version = SCHEMA_VERSION;
  merged.type = type;
  merged.payload = base.payload;
  return merged;
}
