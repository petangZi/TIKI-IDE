#!/usr/bin/env node
// server.mjs — TIKI Universal IDE entry point.
// Wires config, storage, event bus, adapters, engine, security, and HTTP routes.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ConfigError } from "./src/config.mjs";
import { createLogger } from "./src/logger.mjs";
import { createStore } from "./src/storage/store.mjs";
import { createRunStore } from "./src/storage/runs.mjs";
import { createWorkspace } from "./src/workspace/files.mjs";
import { createSnapshotManager } from "./src/workspace/snapshot.mjs";
import { createEventBus } from "./src/events/bus.mjs";
import { createPromptManager } from "./src/prompt/manager.mjs";
import { createPolicy } from "./src/security/policy.mjs";
import { createAuth } from "./src/security/auth.mjs";
import { createAuditLog } from "./src/security/audit.mjs";
import { createAdapterRegistry } from "./src/adapters/registry.mjs";
import { createToolRegistry } from "./src/tools/registry.mjs";
import { createMcpManager } from "./src/mcp/client.mjs";
import { createSubagentRegistry } from "./src/subagents/registry.mjs";
import { createPriceCatalog } from "./src/engine/prices.mjs";
import { createUsageLedger } from "./src/engine/cost.mjs";
import { createOrchestrator } from "./src/engine/orchestrator.mjs";
import { createScheduler } from "./src/engine/scheduler.mjs";
import { createRouter } from "./src/api/router.mjs";
import { sendJson } from "./src/api/respond.mjs";
import { registerSystemRoutes } from "./src/api/routes/system.mjs";
import { registerWorkspaceRoutes } from "./src/api/routes/workspace.mjs";
import { registerAgentRoutes } from "./src/api/routes/agents.mjs";
import { registerSubagentRoutes } from "./src/api/routes/subagents.mjs";
import { registerToolRoutes } from "./src/api/routes/tools.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const VERSION = "1.0.0";

export function buildServices(config, logger) {
  const store = createStore({ dataDir: config.dataDir });
  const bus = createEventBus({ store, logger });
  const runs = createRunStore(store, { logger });
  const workspace = createWorkspace({ root: config.workspace, maxFileBytes: config.maxFileBytes });
  const snapshots = createSnapshotManager({ workspace, store });
  const promptManager = createPromptManager(config.configDir);
  const policy = createPolicy({ workspace, config });
  const auth = createAuth({ config });
  const audit = createAuditLog({ store, logger });
  const adapters = createAdapterRegistry({ config, logger });
  const prices = createPriceCatalog({ store, logger });
  const usage = createUsageLedger({ store, prices, logger });
  const tools = createToolRegistry({ config, logger, audit });
  const mcp = createMcpManager({ store, logger });
  const subagents = createSubagentRegistry({ store, adapters, logger });
  const orchestrator = createOrchestrator({ config, bus, adapters, runs, workspace, snapshots, usage, policy, promptManager, logger });
  const scheduler = createScheduler({ store, bus, orchestrator, subagents, logger, concurrency: 2 });
  scheduler.recover();

  return {
    version: VERSION, config, logger, store, bus, runs, workspace, snapshots, promptManager,
    policy, auth, audit, adapters, prices, usage, tools, mcp, subagents, orchestrator, scheduler
  };
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const abs = path.resolve(PUBLIC, requested);
  if (abs !== PUBLIC && !abs.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return sendJson(res, 404, { error: "Not found" });
  const ext = path.extname(abs);
  const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" }[ext] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'"
  });
  return fs.createReadStream(abs).pipe(res);
}

export function createServer(services) {
  const router = createRouter();
  registerSystemRoutes(router, services);
  registerWorkspaceRoutes(router, services);
  registerAgentRoutes(router, services);
  registerSubagentRoutes(router, services);
  registerToolRoutes(router, services);

  // SSE endpoint is handled outside the JSON router (it owns its response).
  router.get("/api/events", (ctx) => {
    services.bus.attach(ctx.req, ctx.res);
    return { __raw: true };
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    res.setHeader("x-tiki-version", services.version);

    // Auth gate (loopback-open, remote requires token).
    const rejection = services.auth.check(req);
    if (rejection) return sendJson(res, rejection.status, { error: rejection.error, code: "UNAUTHORIZED" });

    try {
      if (url.pathname.startsWith("/api/")) return await router.handle(req, res, services);
      return serveStatic(req, res, url);
    } catch (error) {
      services.logger.error("request failed", { path: url.pathname, error: error.message });
      if (!res.headersSent) sendJson(res, 500, { error: "Internal server error", code: "INTERNAL" });
      else res.end();
    }
  });
  return server;
}

async function main() {
  let config;
  try { config = loadConfig({}); }
  catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`\n  TIKI configuration error:\n    ${error.message}\n\n`);
      process.exit(2);
    }
    throw error;
  }
  const logger = createLogger("tiki", config.logLevel);
  const services = buildServices(config, logger);
  const server = createServer(services);

  const shutdown = async (signal) => {
    logger.info("shutting down", { signal });
    services.orchestrator.cancelAll();
    await services.mcp.closeAll().catch(() => {});
    services.bus.close();
    services.store.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.port, config.host, () => {
    const urlHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
    process.stdout.write("\n");
    process.stdout.write("  TIKI Universal IDE · v" + VERSION + "\n");
    process.stdout.write("  ────────────────────────────────────────────\n");
    process.stdout.write(`  Local URL : http://${urlHost}:${config.port}\n`);
    process.stdout.write(`  Workspace : ${config.workspace}\n`);
    process.stdout.write(`  Data      : ${config.dataDir}\n`);
    process.stdout.write(`  Runtime   : ${process.version} · ${process.platform}/${process.arch}\n`);
    process.stdout.write(`  Security  : ${config.isLoopback ? "loopback bind (open)" : "remote bind (token required)"}\n`);
    process.stdout.write("  Stop with : Ctrl+C\n\n");
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { process.stderr.write(`Fatal: ${error.stack || error.message}\n`); process.exit(1); });
