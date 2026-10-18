// src/api/routes/subagents.mjs
import { ApiError } from "../respond.mjs";

export function registerSubagentRoutes(router, services) {
  const { subagents, scheduler, bus } = services;

  router.get("/api/subagents", () => ({ subagents: subagents.list(), roles: subagents.roles }));
  router.post("/api/subagents", async (ctx) => {
    const body = await ctx.readBody();
    const item = subagents.add(body);
    bus.emitSafe({ type: "subagent.added", payload: { subagent: item }, text: `Added sub-agent: ${item.name}` });
    return { __status: 201, body: { subagent: item, subagents: subagents.list() } };
  });
  router.patch("/api/subagents/:id", async (ctx) => {
    const body = await ctx.readBody();
    const item = subagents.update(ctx.params.id, body);
    bus.emitSafe({ type: "subagent.updated", payload: { subagent: item }, text: `Updated sub-agent: ${item.name}` });
    return { subagent: item, subagents: subagents.list() };
  });
  router.delete("/api/subagents/:id", (ctx) => {
    const items = subagents.remove(ctx.params.id);
    bus.emitSafe({ type: "subagent.removed", text: `Removed sub-agent ${ctx.params.id}` });
    return { subagents: items };
  });

  router.get("/api/tasks", () => ({ tasks: scheduler.list(), stats: scheduler.stats() }));
  router.get("/api/tasks/stats", () => scheduler.stats());
  router.post("/api/tasks", async (ctx) => {
    const body = await ctx.readBody();
    if (!body.agent || !body.prompt) throw new ApiError("agent and prompt are required", 400, "BAD_INPUT");
    const task = scheduler.enqueue({
      title: body.title,
      agentId: body.agent,
      prompt: body.prompt,
      dependsOn: Array.isArray(body.depends_on) ? body.depends_on : [],
      parentRunId: body.parent_run_id || null,
      subagentId: body.subagent_id || null,
      maxRetries: Number.isInteger(body.max_retries) ? body.max_retries : 1
    });
    return { __status: 201, body: { task } };
  });
  router.post("/api/tasks/:id/cancel", (ctx) => {
    const result = scheduler.cancel(ctx.params.id);
    if (!result.cancelled) throw new ApiError("Task not cancellable", 404, "NOT_FOUND");
    return result;
  });
}
