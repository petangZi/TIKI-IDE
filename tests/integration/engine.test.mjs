import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.mjs";
import { createLogger } from "../../src/logger.mjs";
import { buildServices } from "../../server.mjs";

function harness() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-engine-ws-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-engine-data-"));
  fs.writeFileSync(path.join(workspace, "readme.md"), "seed\n");
  const config = loadConfig({ env: { TIKI_WORKSPACE: workspace, TIKI_DATA_DIR: dataDir, TIKI_LOG_LEVEL: "error" }, argv: [] });
  const services = buildServices(config, createLogger("test", "error"));
  const dispose = () => {
    services.orchestrator.cancelAll();
    services.bus.close();
    services.store.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { services, workspace, dispose };
}

const waitFor = async (fn, timeoutMs = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
};

test("orchestrator completes a mock run and emits ordered events", async () => {
  const { services, dispose } = harness();
  const started = services.orchestrator.start({ agentId: "mock", prompt: "engine test" });
  const result = await started.promise;
  assert.equal(result.run.status, "completed");
  assert.ok(result.text.includes("Done."));
  assert.ok(result.diff && typeof result.diff.counts === "object");

  const types = services.bus.replay(0).map((e) => e.type);
  assert.ok(types.includes("run.queued"));
  assert.ok(types.includes("run.started"));
  assert.ok(types.includes("run.completed"));
  assert.ok(types.indexOf("run.started") < types.indexOf("run.completed"));
  dispose();
});

test("usage ledger records a priced entry for the run", async () => {
  const { services, dispose } = harness();
  const started = services.orchestrator.start({ agentId: "mock", prompt: "usage test" });
  await started.promise;
  const summary = services.usage.summary();
  assert.equal(summary.records, 1);
  assert.equal(summary.runs, 1);
  assert.equal(typeof summary.user_charge, "number");
  dispose();
});

test("scheduler runs dependency-ordered tasks", async () => {
  const { services, dispose } = harness();
  const first = services.scheduler.enqueue({ title: "first", agentId: "mock", prompt: "one" });
  const second = services.scheduler.enqueue({ title: "second", agentId: "mock", prompt: "two", dependsOn: [first.id] });

  const done = await waitFor(() => {
    const list = services.scheduler.list();
    return list.every((t) => t.status === "completed");
  });
  assert.equal(done, true, JSON.stringify(services.scheduler.list().map((t) => t.status)));
  const firstDone = services.scheduler.get(first.id).completed_at;
  const secondStart = services.scheduler.get(second.id).started_at;
  assert.ok(Date.parse(secondStart) >= Date.parse(firstDone), "dependency ran before its parent finished");
  dispose();
});

test("scheduler blocks tasks whose dependency failed", async () => {
  const { services, dispose } = harness();
  const bad = services.scheduler.enqueue({ title: "bad", agentId: "does-not-exist", prompt: "x" });
  services.scheduler.update(bad.id, { status: "failed" });
  const child = services.scheduler.enqueue({ title: "child", agentId: "mock", prompt: "y", dependsOn: [bad.id] });
  const blocked = await waitFor(() => services.scheduler.get(child.id)?.status === "blocked");
  assert.equal(blocked, true);
  dispose();
});

test("sub-agent registry round-trips through the store", async () => {
  const { services, dispose } = harness();
  const item = services.subagents.add({ name: "Reviewer", role: "reviewer", adapter: "mock" });
  assert.equal(item.enabled, true);
  assert.equal(services.subagents.get(item.id).name, "Reviewer");
  services.subagents.update(item.id, { enabled: false });
  assert.equal(services.subagents.get(item.id).enabled, false);
  assert.equal(services.subagents.remove(item.id).length, 0);
  dispose();
});
