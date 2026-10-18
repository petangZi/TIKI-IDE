// src/api/routes/agents.mjs
import { ApiError } from "../respond.mjs";

export function registerAgentRoutes(router, services) {
  const { orchestrator, runs, snapshots, adapters, bus, policy } = services;
  let lastBaseline = null; // baseline captured at first run, used for cumulative diff

  router.post("/api/chat", async (ctx) => {
    const body = await ctx.readBody();
    if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new ApiError("prompt is required", 400, "BAD_INPUT");
    if (body.prompt.length > 20_000) throw new ApiError("prompt too long (max 20,000 chars)", 413, "PROMPT_TOO_LONG");
    const agentId = body.agent || "mock";
    adapters.require(agentId);

    if (!lastBaseline) lastBaseline = snapshots.capture({ label: "session-baseline" });

    const started = orchestrator.start({ agentId, prompt: body.prompt.trim(), model: body.model || null });
    try {
      const result = await started.promise;
      return { run: started.run, run_id: started.run.id, status: "completed", answer: result.text, diff: result.diff, usage: result.usage, cost: result.cost };
    } catch (error) {
      const run = runs.get(started.run.id);
      throw new ApiError(error.message, run?.status === "cancelled" ? 499 : 502, run?.status === "cancelled" ? "RUN_CANCELLED" : "RUN_FAILED", { run_id: started.run.id });
    }
  });

  // Fire-and-observe: returns immediately, stream via /api/events.
  router.post("/api/runs", async (ctx) => {
    const body = await ctx.readBody();
    if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new ApiError("prompt is required", 400, "BAD_INPUT");
    const agentId = body.agent || "mock";
    adapters.require(agentId);
    const started = orchestrator.start({ agentId, prompt: body.prompt.trim(), model: body.model || null, parentRunId: body.parent_run_id || null });
    started.promise.catch(() => { /* surfaced via events + run status */ });
    return { __status: 202, body: { run: started.run, run_id: started.run.id, status: "queued" } };
  });

  router.get("/api/runs", (ctx) => ({ runs: runs.list({ limit: Number(ctx.query.get("limit")) || 100, status: ctx.query.get("status") || null }) }));

  router.get("/api/runs/:id", (ctx) => {
    const run = runs.get(ctx.params.id);
    if (!run) throw new ApiError("Run not found", 404, "NOT_FOUND");
    return { run };
  });

  router.post("/api/runs/:id/cancel", (ctx) => {
    const run = runs.get(ctx.params.id);
    if (!run) throw new ApiError("Run not found", 404, "NOT_FOUND");
    const result = orchestrator.cancel(ctx.params.id);
    if (!result.cancelled && ["queued", "running", "waiting_approval"].includes(run.status)) {
      runs.update(ctx.params.id, { status: "cancelled", completed_at: new Date().toISOString() });
      bus.emitSafe({ run_id: ctx.params.id, type: "run.cancelled", text: "Run cancelled" });
      return { cancelled: true, run_id: ctx.params.id };
    }
    return result;
  });

  router.get("/api/approvals", () => ({ pending: policy.pending() }));
  router.post("/api/approvals/:id/decision", async (ctx) => {
    const body = await ctx.readBody();
    const ok = policy.decide(ctx.params.id, body.approved !== false, body.reason || null);
    if (!ok) throw new ApiError("No such approval", 404, "NOT_FOUND");
    return { ok: true, id: ctx.params.id, approved: body.approved !== false };
  });
}
