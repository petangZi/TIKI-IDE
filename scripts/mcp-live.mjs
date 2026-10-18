// scripts/mcp-live.mjs
// Live connectivity check for the built-in MCP catalog.
//
// The unit suite exercises the protocol against an in-process fake, which the
// default gates can run offline. This script is the network-backed counterpart:
// it installs real built-ins, spawns (or dials) them exactly as the IDE would,
// and reports the tools each one actually exposes.
//
//   node scripts/mcp-live.mjs                     # keyless built-ins
//   node scripts/mcp-live.mjs context7 magic       # explicit selection
//   node scripts/mcp-live.mjs bolt --cwd=~/bolt    # clone-based servers
//
// Built-ins that need credentials are skipped unless their env var is set.
// Not part of `check`, `test` or `test:smoke` — it needs the network and a
// cold `npx` can take a minute.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStore } from "../src/storage/store.mjs";
import { createMcpManager } from "../src/mcp/client.mjs";
import { getBuiltin, missingEnv } from "../src/mcp/builtins.mjs";

const DEFAULT_IDS = ["context7", "context7-remote", "frontend-inspo", "lightswind"];

function parseArgs(argv) {
  const ids = [];
  let timeout = 120_000;
  let cwd;
  for (const arg of argv) {
    if (arg.startsWith("--timeout=")) timeout = Number(arg.split("=")[1]) || timeout;
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (!arg.startsWith("-")) ids.push(arg);
  }
  return { ids: ids.length > 0 ? ids : DEFAULT_IDS, timeout, cwd };
}

const { ids, timeout, cwd } = parseArgs(process.argv.slice(2));
const dataDir = await mkdtemp(join(tmpdir(), "tiki-mcp-live-"));
const logger = {
  warn: (msg) => process.stderr.write(`  warn: ${msg}\n`),
  info: () => {},
  debug: () => {}
};

const results = [];

try {
  const store = createStore({ dataDir });
  const mcp = createMcpManager({ store, logger, initTimeoutMs: timeout });

  for (const id of ids) {
    // getBuiltin also resolves variants (context7-remote, bolt-http, …) and
    // children, which listBuiltins deliberately does not enumerate.
    const known = getBuiltin(id);
    if (!known) {
      console.log(`${id.padEnd(18)} skipped   unknown built-in`);
      results.push({ id, ok: false, reason: "unknown" });
      continue;
    }
    const missing = missingEnv(known, process.env);
    if (missing.length > 0) {
      console.log(`${id.padEnd(18)} skipped   needs ${missing.join(", ")}`);
      results.push({ id, ok: true, reason: "skipped" });
      continue;
    }
    // Servers like bolt only run from a checkout the user made; without one
    // there is nothing to spawn.
    if (known.cwdHint && !cwd) {
      console.log(`${id.padEnd(18)} skipped   runs from a directory you supply — pass --cwd=<path>`);
      results.push({ id, ok: true, reason: "skipped" });
      continue;
    }

    const started = Date.now();
    try {
      const server = mcp.installBuiltin(id, { trust: "trusted", cwd });
      await mcp.connect(server.id);
      const info = await mcp.describe(server.id);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const names = info.tools.map((t) => t.name);
      console.log(
        `${id.padEnd(18)} ok        ${secs}s  ${info.serverInfo?.name || "?"} ` +
          `v${info.serverInfo?.version || "?"}  ${names.length} tools`
      );
      console.log(`${" ".repeat(20)}${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}`);
      results.push({ id, ok: true, tools: names.length });
    } catch (error) {
      console.log(`${id.padEnd(18)} FAILED    ${error.message}`);
      results.push({ id, ok: false, reason: error.message });
    }
  }

  await mcp.closeAll();
} finally {
  await rm(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} built-ins verified live`);
process.exit(failed.length === 0 ? 0 : 1);
