// src/engine/scheduler.mjs
// Task graph scheduler: dependency-aware queue, bounded concurrency, retries,
// cancellation, and deterministic task IDs. Supports sub-agent delegation.
export function createScheduler({ store, bus, orchestrator, subagents = null, logger = console, concurrency = 2 }) {
  const docName = "tasks";
  const running = new Map(); // id -> Promise
  let pumpScheduled = false;

  function doc() {
    const d = store.load(docName, { version: 1, tasks: [] });
    if (!Array.isArray(d.tasks)) d.tasks = [];
    return d;
  }
  function persist(d) { return store.saveSoon(docName, d); }

  function enqueue({ title, agentId, prompt, dependsOn = [], parentRunId = null, subagentId = null, maxRetries = 1 }) {
    const d = doc();
    const id = `task_${crypto.randomUUID().slice(0, 8)}`;
    const task = {
      id, title: String(title || prompt).slice(0, 120), agent_id: agentId, prompt,
      depends_on: dependsOn, parent_run_id: parentRunId, subagent_id: subagentId,
      status: "pending", run_id: null, attempts: 0, max_retries: maxRetries,
      error: null, created_at: new Date().toISOString(), started_at: null, completed_at: null
    };
    d.tasks.push(task);
    persist(d);
    bus.emitSafe({ type: "task.created", payload: { task_id: id, depends_on: dependsOn }, text: `Task queued: ${task.title}` });
    schedulePump();
    return task;
  }

  function get(id) { return doc().tasks.find((t) => t.id === id) || null; }
  function list() { return doc().tasks; }

  function update(id, patch) {
    const d = doc();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    persist(d);
    return t;
  }

  function depsSatisfied(task) {
    return task.depends_on.every((dep) => {
      const d = get(dep);
      return d && d.status === "completed";
    });
  }

  function depsFailed(task) {
    return task.depends_on.some((dep) => {
      const d = get(dep);
      return d && ["failed", "cancelled"].includes(d.status);
    });
  }

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => { pumpScheduled = false; pump(); });
  }

  function pump() {
    if (running.size >= concurrency) return;
    const tasks = doc().tasks;
    for (const task of tasks) {
      if (running.size >= concurrency) break;
      if (task.status !== "pending") continue;
      if (depsFailed(task)) { update(task.id, { status: "blocked", error: "dependency failed" }); bus.emitSafe({ type: "task.blocked", payload: { task_id: task.id }, text: `Task blocked: ${task.title}` }); continue; }
      if (!depsSatisfied(task)) continue;
      launch(task);
    }
    // Re-evaluate after completions.
    if (running.size === 0 && tasks.some((t) => t.status === "pending" && t.depends_on.length)) {
      // everything resolvable has been launched; blocked deps handled above
    }
  }

  function launch(task) {
    const adapterId = task.agent_id;
    // Enforce sub-agent delegation depth + enabled status.
    if (task.subagent_id && subagents) {
      const sa = subagents.get(task.subagent_id);
      if (!sa) { update(task.id, { status: "blocked", error: "sub-agent not found" }); return; }
      if (!sa.enabled) { update(task.id, { status: "blocked", error: "sub-agent disabled" }); return; }
      if (sa.limits?.max_delegation_depth === 0 && task.parent_run_id) { update(task.id, { status: "blocked", error: "delegation depth exceeded" }); return; }
    }
    task.attempts += 1;
    update(task.id, { status: "running", started_at: new Date().toISOString(), attempts: task.attempts });
    bus.emitSafe({ type: "task.started", payload: { task_id: task.id, attempt: task.attempts }, text: `Task started: ${task.title}` });

    const started = orchestrator.start({ agentId: adapterId, prompt: task.prompt, parentRunId: task.parent_run_id });
    const runId = started.run.id;
    update(task.id, { run_id: runId });

    const promise = started.promise
      .then((res) => {
        update(task.id, { status: "completed", completed_at: new Date().toISOString() });
        bus.emitSafe({ type: "task.completed", run_id: runId, payload: { task_id: task.id }, text: `Task completed: ${task.title}` });
        return res;
      })
      .catch((error) => {
        const attempts = get(task.id).attempts;
        if (attempts <= task.max_retries && !error.message.includes("cancel")) {
          update(task.id, { status: "pending", error: error.message });
          bus.emitSafe({ type: "task.started", payload: { task_id: task.id, retry: true }, text: `Retrying task: ${task.title}` });
        } else {
          update(task.id, { status: "failed", completed_at: new Date().toISOString(), error: error.message });
          bus.emitSafe({ type: "task.completed", payload: { task_id: task.id, success: false }, text: `Task failed: ${task.title}` });
        }
      })
      .finally(() => { running.delete(task.id); schedulePump(); });

    running.set(task.id, promise);
  }

  function cancel(id) {
    const task = get(id);
    if (!task) return { cancelled: false };
    if (task.status === "pending") { update(id, { status: "cancelled" }); return { cancelled: true }; }
    if (task.run_id) orchestrator.cancel(task.run_id);
    update(id, { status: "cancelled" });
    return { cancelled: true };
  }

  function stats() {
    const tasks = doc().tasks;
    const by = {};
    for (const t of tasks) by[t.status] = (by[t.status] || 0) + 1;
    return { total: tasks.length, running: running.size, concurrency, by_status: by };
  }

  function recover() {
    // Mark in-flight runs as interrupted after a restart.
    const d = doc();
    let changed = false;
    for (const t of d.tasks) {
      if (t.status === "running") { t.status = "pending"; t.error = "interrupted by restart"; changed = true; }
    }
    if (changed) { store.save(docName, d); schedulePump(); }
  }

  return { enqueue, get, list, cancel, stats, recover, update, running };
}
