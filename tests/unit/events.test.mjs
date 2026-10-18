import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, isEphemeral, makeEnvelope, EventValidationError, EVENT_TYPES } from "../../src/events/schema.mjs";
import { createEventBus } from "../../src/events/bus.mjs";

test("validateEvent rejects unknown types", () => {
  assert.throws(() => validateEvent({ type: "bogus.event" }), (e) => e instanceof EventValidationError);
});

test("validateEvent requires a type", () => {
  assert.throws(() => validateEvent({}), (e) => e instanceof EventValidationError);
});

test("validateEvent accepts a canonical type", () => {
  assert.equal(validateEvent({ type: "run.started" }), true);
});

test("delta events are ephemeral", () => {
  assert.equal(isEphemeral("agent.message.delta"), true);
  assert.equal(isEphemeral("run.completed"), false);
});

test("makeEnvelope preserves the contract fields", () => {
  const env = makeEnvelope({ type: "run.started", runId: "r1", text: "go", extra: { type: "run.failed" } });
  assert.equal(env.type, "run.started");
  assert.equal(env.run_id, "r1");
  assert.equal(env.payload.text, "go");
  assert.equal(env.sequence, null);
});

test("bus assigns monotonic sequences and replays them", () => {
  const bus = createEventBus({ store: null, logger: { warn() {} } });
  const a = bus.emit({ type: "run.started" });
  const b = bus.emit({ type: "run.completed" });
  assert.equal(a.sequence, 1);
  assert.equal(b.sequence, 2);
  assert.equal(bus.replay(1).length, 1);
  assert.equal(bus.replay(0).length, 2);
  bus.close();
});

test("every canonical type builds an envelope", () => {
  for (const type of EVENT_TYPES) {
    const env = makeEnvelope({ type });
    assert.equal(validateEvent(env), true);
  }
});
