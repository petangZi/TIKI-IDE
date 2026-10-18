// src/engine/orchestrator.mjs
// Owns agent run lifecycle: queue -> run -> observe -> diff -> usage -> complete.
// Emits only truthful events supported by real observations.
const DEFAULT_TIMEOUT_MS = 600_000;

export function createOrchestrator({ config, bus, adapters, runs, workspace, snapshots, usage, policy, promptManager, logger = console }) {
  const active = new Map(); // runId -> { controller, startedAt, adapterId }

  function emitRun(run, partial) {
    return bus.emitSafe({
      run_id: run.id,
      parent_run_id: run.parent_run_id,
      agent_id: partial.agent_id || run.agent_id,
      adapter_id: partial.adapter_id || run.adapter_id,
      session_id: run.session_id,
      ...partial
    });
  }

  /**
   * Start a run. Returns the run record immediately; execution proceeds async.
   * `awaitDone` is used by tests and synchronous callers.
   */
  function start({ agentId, prompt, parentRunId = null, model = null, timeoutMs = DEFAULT_TIMEOUT_MS, awaitDone = false }) {
    const adapter = adapters.require(agentId);
    const promptConfig = promptManager.get();
    const run = runs.create({
      agentId,
      adapterId: adapter.id,
      parentRunId,
      prompt,
      promptVersion: promptConfig.version,
      workspace: workspace.root,
      status: "queued"
    });

    const promise = execute({ run, adapter, prompt, promptConfig, model, timeoutMs });

    emitRun(run, { type: "run.queued", text: `Queued run on ${adapter.name}` });
    emitRun(run, { type: "prompt.attached", promptVersion: promptConfig.version, text: `TIKI core prompt attached · ${promptConfig.version}` });
    emitRun(run, { type: "run.started", text: `Started ${adapter.name} run` });

    if (awaitDone) return promise;
    return { run, promise };
  }

  async function execute({ run, adapter, prompt, promptConfig, model, timeoutMs }) {
    const controller = new AbortController();
    active.set(run.id, { controller, startedAt: Date.now(), adapterId: adapter.id });
    runs.update(run.id, { status: "running", started_at: new Date().toISOString() });

    const baseline = snapshots.capture({ label: `baseline:${run.id}` });
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Run timed out")); }, timeoutMs);
    });

    const onEvent = (partial) => {
      // Adapter-provided events are re-framed onto the run envelope.
      bus.emitSafe({ run_id: run.id, parent_run_id: run.parent_run_id, agent_id: run.agent_id, adapter_id: run.adapter_id, session_id: run.session_id, ...partial });
    };

    try {
      const result = await Promise.race([
        adapter.run({ prompt, systemPrompt: promptConfig.effectivePrompt, signal: controller.signal, onEvent, modelOverride: model, onSession: (sid) => { run.session_id = sid; runs.update(run.id, { session_id: sid }); } }),
        timeout
      ]);
      if (controller.signal.aborted && !timer) throw new Error("Run cancelled");
      clearTimeout(timer);

      const text = result?.text || "";
      if (text) emitRun(run, { type: "agent.message.completed", text });

      const diff = snapshots.diffAgainst(baseline);
      emitRun(run, { type: "diff.updated", payload: { counts: diff.counts, additions: diff.additions, deletions: diff.deletions }, text: `Workspace diff: ${diff.counts.added} added, ${diff.counts.modified} modified, ${diff.counts.deleted} deleted` });
      for (const file of diff.files) {
        if (file.status === "added") emitRun(run, { type: "file.created", payload: { path: file.path }, text: `Created ${file.path}` });
        else if (file.status === "deleted") emitRun(run, { type: "file.deleted", payload: { path: file.path }, text: `Deleted ${file.path}` });
        else emitRun(run, { type: "file.changed", payload: { path: file.path, additions: file.additions, deletions: file.deletions }, text: `Changed ${file.path}` });
      }

      let usageRecord = null;
      if (result?.usage) {
        emitRun(run, { type: "usage.reported", payload: result.usage, text: "Provider reported token usage" });
        usageRecord = usage.record({ workspaceId: workspace.root, runId: run.id, provider: providerOf(adapter, model, config), model: model || defaultModel(adapter, config), usage: result.usage, source: "provider_response" });
        emitRun(run, { type: "cost.updated", payload: { provider_cost: usageRecord.provider_cost, user_charge: usageRecord.final_user_charge, currency: usageRecord.currency, price_version: usageRecord.price_version }, text: `Cost ${usageRecord.currency} ${usageRecord.final_user_charge}` });
      }

      const completed = runs.update(run.id, { status: "completed", completed_at: new Date().toISOString(), usage: result?.usage || null, cost: usageRecord ? { provider_cost: usageRecord.provider_cost, user_charge: usageRecord.final_user_charge, currency: usageRecord.currency } : null });
      emitRun(run, { type: "run.completed", text: "Run completed", payload: { success: true } });
      active.delete(run.id);
      return { run: completed, text, diff, usage: result?.usage || null, cost: usageRecord };
    } catch (error) {
      if (timer) clearTimeout(timer);
      const cancelled = controller.signal.aborted && error.message !== "Run timed out";
      const status = cancelled ? "cancelled" : "failed";
      runs.update(run.id, { status, completed_at: new Date().toISOString(), error: error.message });
      emitRun(run, { type: cancelled ? "run.cancelled" : "run.failed", text: cancelled ? "Run cancelled" : `Run failed: ${error.message}` });
      active.delete(run.id);
      throw error;
    }
  }

  function cancel(runId) {
    const entry = active.get(runId);
    if (!entry) return { cancelled: false, reason: "not active" };
    entry.controller.abort();
    return { cancelled: true, run_id: runId };
  }

  function cancelAll() {
    for (const [id] of active) cancel(id);
  }

  function activeRuns() {
    return [...active.entries()].map(([id, v]) => ({ run_id: id, adapter_id: v.adapterId, started_at: v.startedAt }));
  }

  return { start, cancel, cancelAll, activeRuns, active };
}

function providerOf(adapter, model, config) {
  if (adapter.kind === "mock") return "local";
  if (adapter.id === "opencode") return "local";
  return adapter.id;
}

function defaultModel(adapter, config) {
  if (adapter.id === "hermes") return config.agents.hermes.model;
  if (adapter.id === "openclaw") return config.agents.openclaw.model;
  return "*";
}
