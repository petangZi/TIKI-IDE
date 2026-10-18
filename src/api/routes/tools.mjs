// src/api/routes/tools.mjs
import { ApiError } from "../respond.mjs";
import { search as searchPublicApis, stats as publicApiStats } from "../../tools/public-apis/catalog.mjs";

export function registerToolRoutes(router, services) {
  const { tools, mcp, prices, bus, audit } = services;

  router.get("/api/tools", () => ({ tools: tools.list() }));
  router.get("/api/tools/catalog", () => ({ categories: tools.catalog(), tools: tools.list() }));

  // --- Curated public APIs (browse the catalog the AI can call) ---
  router.get("/api/public-apis/stats", () => publicApiStats());
  router.get("/api/public-apis", (ctx) => searchPublicApis({
    query: ctx.query.get("query") || ctx.query.get("q") || "",
    category: ctx.query.get("category") || "",
    auth: ctx.query.get("auth") || "",
    httpsOnly: ["1", "true", "yes"].includes((ctx.query.get("httpsOnly") || "").toLowerCase()),
    limit: Number(ctx.query.get("limit")) || 20,
    offset: Number(ctx.query.get("offset")) || 0
  }));
  router.post("/api/tools/:id/invoke", async (ctx) => {
    const body = await ctx.readBody();
    bus.emitSafe({ type: "tool.requested", payload: { tool: ctx.params.id }, text: `Tool requested: ${ctx.params.id}` });
    bus.emitSafe({ type: "tool.started", payload: { tool: ctx.params.id }, text: `Tool started: ${ctx.params.id}` });
    try {
      const result = await tools.invoke(ctx.params.id, body.args || body, { actor: "user" });
      bus.emitSafe({ type: "tool.completed", payload: { tool: ctx.params.id, duration_ms: result.duration_ms }, text: `Tool completed: ${ctx.params.id}` });
      return result;
    } catch (error) {
      bus.emitSafe({ type: "tool.failed", payload: { tool: ctx.params.id, error: error.message }, text: `Tool failed: ${ctx.params.id}` });
      throw error;
    }
  });

  // --- MCP ---
  router.get("/api/mcp/builtins", () => ({ builtins: mcp.listBuiltins() }));
  router.post("/api/mcp/builtins/:id/install", async (ctx) => {
    let body = {};
    try { body = (await ctx.readBody()) || {}; } catch { body = {}; }
    const server = mcp.installBuiltin(ctx.params.id, body);
    audit.record({ actor: "user", action: "mcp.builtin.install", target: ctx.params.id });
    return { __status: 201, body: { server, servers: mcp.listServers() } };
  });
  router.get("/api/mcp/servers", () => ({ servers: mcp.listServers() }));
  router.post("/api/mcp/servers", async (ctx) => {
    const body = await ctx.readBody();
    const server = mcp.addServer(body);
    audit.record({ actor: "user", action: "mcp.server.add", target: server.name });
    return { __status: 201, body: { server, servers: mcp.listServers() } };
  });
  router.delete("/api/mcp/servers/:id", (ctx) => ({ servers: mcp.removeServer(ctx.params.id) }));
  router.post("/api/mcp/servers/:id/connect", async (ctx) => {
    await mcp.connect(ctx.params.id);
    return { ok: true, servers: mcp.listServers() };
  });
  router.post("/api/mcp/servers/:id/disconnect", async (ctx) => ({ ...(await mcp.disconnect(ctx.params.id)), servers: mcp.listServers() }));
  router.get("/api/mcp/servers/:id/describe", (ctx) => mcp.describe(ctx.params.id));
  router.post("/api/mcp/servers/:id/call", async (ctx) => {
    const body = await ctx.readBody();
    if (!body.tool) throw new ApiError("tool is required", 400, "BAD_INPUT");
    return mcp.callTool(ctx.params.id, body.tool, body.args || {});
  });

  // --- Prices ---
  router.get("/api/prices", () => ({ entries: prices.list(), markup: prices.markup() }));
  router.post("/api/prices", async (ctx) => {
    const body = await ctx.readBody();
    return { __status: 201, body: { entry: prices.upsert(body) } };
  });
  router.post("/api/prices/markup", async (ctx) => {
    const body = await ctx.readBody();
    return { markup: prices.setMarkup(body.markup) };
  });
}
