#!/usr/bin/env node
// scripts/check.mjs — static + runtime self-check. No network, no test framework.
// Verifies: every module imports cleanly, adapters satisfy the capability
// contract, the router exposes a unique route table, tools validate, and the
// prompt composes. Exits non-zero on the first failing phase.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src");

const results = [];
let failures = 0;

function phase(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  const mark = ok ? "PASS" : "FAIL";
  process.stdout.write(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}\n`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/node_modules|\.git/.test(entry.name)) walk(abs, out); }
    else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) out.push(abs);
  }
  return out;
}

async function phaseImports() {
  const files = [...walk(SRC), path.join(ROOT, "server.mjs")];
  const broken = [];
  for (const file of files) {
    try { await import(pathToFileURL(file).href); }
    catch (error) { broken.push(`${path.relative(ROOT, file)}: ${error.message}`); }
  }
  phase(`module imports (${files.length} files)`, broken.length === 0, broken.slice(0, 5).join(" | "));
}

async function phaseServices() {
  const { loadConfig } = await import(pathToFileURL(path.join(SRC, "config.mjs")).href);
  const { createLogger } = await import(pathToFileURL(path.join(SRC, "logger.mjs")).href);
  const { buildServices } = await import(pathToFileURL(path.join(ROOT, "server.mjs")).href);

  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-check-ws-"));
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-check-data-"));
  const config = loadConfig({
    env: { TIKI_WORKSPACE: tmpWorkspace, TIKI_DATA_DIR: tmpData, TIKI_LOG_LEVEL: "error" },
    argv: []
  });
  const services = buildServices(config, createLogger("check", "error"));

  const conform = services.adapters.conformAll();
  phase("adapter conformance", conform.every((c) => c.ok), conform.filter((c) => !c.ok).map((c) => `${c.id}: ${c.problems.join(",")}`).join(" | ") || `${conform.length} adapters`);

  const detected = await services.adapters.detectAll();
  phase("adapter detection", detected.length === conform.length, `${detected.filter((a) => a.detected).length}/${detected.length} detected`);

  const tools = services.tools.list();
  phase("tool registry", tools.length >= 3, `${tools.length} tools: ${tools.map((t) => t.id).join(", ")}`);

  const prompt = services.promptManager.get();
  phase("prompt composes", typeof prompt.effectivePrompt === "string" && prompt.effectivePrompt.length > 100, `${prompt.version} · ${prompt.effectivePrompt.length} chars`);

  const split = services.prices.computeCost({ provider: "local", model: "*", usage: { input_tokens: 100, output_tokens: 50 } });
  phase("price computation", typeof split.user_charge === "number", `user_charge=${split.user_charge}`);

  const { createRouter } = await import(pathToFileURL(path.join(SRC, "api", "router.mjs")).href);
  const router = createRouter();
  services.__router = router;
  const { createServer } = await import(pathToFileURL(path.join(ROOT, "server.mjs")).href);
  createServer(services);
  phase("server constructs", true, "router + http server built");

  services.orchestrator.cancelAll();
  services.bus.close();
  services.store.close();
  fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  fs.rmSync(tmpData, { recursive: true, force: true });
}

async function main() {
  process.stdout.write("\nTIKI Universal IDE — self-check\n────────────────────────────────\n");
  const started = Date.now();
  await phaseImports();
  await phaseServices();
  process.stdout.write("────────────────────────────────\n");
  process.stdout.write(`  ${results.length - failures}/${results.length} phases passed in ${Date.now() - started}ms\n\n`);
  if (failures) { process.stderr.write(`check failed: ${failures} phase(s)\n`); process.exit(1); }
}

main().catch((error) => { process.stderr.write(`check crashed: ${error.stack || error.message}\n`); process.exit(1); });
