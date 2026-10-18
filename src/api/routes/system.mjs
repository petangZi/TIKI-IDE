// src/api/routes/system.mjs
import os from "node:os";
import { spawnSync } from "node:child_process";
import { ApiError } from "../respond.mjs";

function commandExists(name) {
  try {
    const r = process.platform === "win32"
      ? spawnSync("where", [name], { encoding: "utf8", timeout: 1500, windowsHide: true })
      : spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 1500 });
    return r.status === 0;
  } catch { return false; }
}

export function registerSystemRoutes(router, services) {
  const { config, adapters, promptManager, bus, audit, usage, runs } = services;
  const started = Date.now();

  router.get("/api/health", () => ({ ok: true, name: "TIKI Universal IDE", version: services.version, uptime_ms: Date.now() - started, workspace: config.workspace }));
  router.get("/api/version", () => ({ name: "TIKI Universal IDE", version: services.version, node: process.version, schema_version: "1" }));
  router.get("/api/ready", () => ({ ready: true, workspace: config.workspace, adapters: adapters.list().length }));

  router.get("/api/runtime", async () => ({
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    hostname: os.hostname(),
    workspace: config.workspace,
    pid: process.pid,
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    uptime_ms: Date.now() - started,
    commands: Object.fromEntries(["git", "opencode", "hermes", "openclaw", "npm", "node", "python3"].map((n) => [n, commandExists(n)])),
    agents: await adapters.detectAll()
  }));

  router.get("/api/adapters", () => ({ adapters: adapters.list() }));
  router.get("/api/adapters/conform", () => ({ results: adapters.conformAll() }));
  router.get("/api/adapters/:id/detect", (ctx) => adapters.detect(ctx.params.id));

  router.get("/api/system-prompt", () => {
    const c = promptManager.get();
    return { corePrompt: c.corePrompt, customInstructions: c.customInstructions, version: c.version, customPath: c.customPath, maxCustomCharacters: promptManager.maxCustomCharacters };
  });
  router.put("/api/system-prompt", async (ctx) => {
    const body = await ctx.readBody();
    if (typeof body.customInstructions !== "string") throw new ApiError("Expected customInstructions string", 400, "BAD_INPUT");
    const c = promptManager.updateCustomInstructions(body.customInstructions);
    bus.emitSafe({ type: "prompt.updated", promptVersion: c.version, text: `TIKI custom instructions updated · ${c.version}` });
    return { ok: true, corePrompt: c.corePrompt, customInstructions: c.customInstructions, version: c.version, customPath: c.customPath };
  });

  router.get("/api/capabilities", () => ({
    policy: services.policy.capabilities(),
    auth: services.auth.status(),
    adapters: adapters.list(),
    runs: runs.list({ limit: 1 }).length ? "available" : "available",
    events: bus.stats()
  }));

  router.get("/api/audit", (ctx) => ({ records: audit.list({ limit: Number(ctx.query.get("limit")) || 200 }) }));

  router.get("/api/usage", (ctx) => ({ records: usage.list({ limit: Number(ctx.query.get("limit")) || 200, runId: ctx.query.get("run") || null }) }));
  router.get("/api/usage/summary", () => usage.summary());
}
