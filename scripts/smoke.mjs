#!/usr/bin/env node
// scripts/smoke.mjs — end-to-end HTTP smoke test against a real server instance
// on an ephemeral port. Boots the full service graph, exercises every route
// group, and asserts the response contracts the UI depends on.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) { passed++; process.stdout.write(`  [PASS] ${name}\n`); }
  else { failures.push(name); process.stdout.write(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}\n`); }
}

async function main() {
  const { loadConfig } = await import(pathToFileURL(path.join(ROOT, "src", "config.mjs")).href);
  const { createLogger } = await import(pathToFileURL(path.join(ROOT, "src", "logger.mjs")).href);
  const { buildServices, createServer } = await import(pathToFileURL(path.join(ROOT, "server.mjs")).href);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-smoke-ws-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-smoke-data-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# Smoke workspace\n");

  const config = loadConfig({ env: { TIKI_WORKSPACE: workspace, TIKI_DATA_DIR: dataDir, TIKI_LOG_LEVEL: "error", TIKI_PORT: "0" }, argv: [] });
  const services = buildServices(config, createLogger("smoke", "error"));
  const server = createServer(services);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = async (method, url, body) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["x-tiki-csrf"] = "1";
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };

  process.stdout.write("\nTIKI smoke test\n────────────────\n");

  const health = await json("GET", "/api/health");
  check("GET /api/health", health.status === 200 && health.data.ok === true, `status ${health.status}`);

  const runtime = await json("GET", "/api/runtime");
  check("GET /api/runtime returns agents", runtime.status === 200 && Array.isArray(runtime.data.agents) && runtime.data.agents.length >= 4, `${runtime.data?.agents?.length} agents`);

  const caps = await json("GET", "/api/capabilities");
  check("GET /api/capabilities", caps.status === 200 && caps.data.auth?.mode === "loopback-open", JSON.stringify(caps.data?.auth));

  const tree = await json("GET", "/api/tree");
  check("GET /api/tree lists files", tree.status === 200 && tree.data.entries.some((e) => e.name === "README.md"), `${tree.data?.entries?.length} entries`);

  const written = await json("POST", "/api/file", { path: "src/hello.js", content: "export const hi = 1;\n", create: true });
  check("POST /api/file creates", written.status === 200 && written.data.created === true, JSON.stringify(written.data));

  const read = await json("GET", "/api/file?path=src/hello.js");
  check("GET /api/file reads", read.status === 200 && read.data.content.includes("hi = 1"), `hash ${read.data?.hash}`);

  const escape = await json("GET", "/api/file?path=../../etc/passwd");
  check("GET /api/file blocks traversal", escape.status === 403 || escape.status === 404, `status ${escape.status}`);

  const tools = await json("GET", "/api/tools");
  check("GET /api/tools", tools.status === 200 && tools.data.tools.length >= 3, `${tools.data?.tools?.length} tools`);

  const invoke = await json("POST", "/api/tools/mock.echo/invoke", { args: { value: "ping" } });
  check("POST /api/tools/:id/invoke", invoke.status === 200 && invoke.data.data?.echoed === "ping", JSON.stringify(invoke.data?.data));

  const badTool = await json("POST", "/api/tools/mock.echo/invoke", { args: {} });
  check("tool input schema rejects bad args", badTool.status === 400, `status ${badTool.status}`);

  const chat = await json("POST", "/api/chat", { agent: "mock", prompt: "smoke test" });
  check("POST /api/chat completes run", chat.status === 200 && chat.data.status === "completed" && typeof chat.data.answer === "string", chat.data?.status);

  const runs = await json("GET", "/api/runs");
  check("GET /api/runs records the run", runs.status === 200 && runs.data.runs.length >= 1, `${runs.data?.runs?.length} runs`);

  const usage = await json("GET", "/api/usage/summary");
  check("GET /api/usage/summary", usage.status === 200 && typeof usage.data.user_charge === "number", `charge ${usage.data?.user_charge}`);

  await json("POST", "/api/diff/reset");
  const diffClean = await json("POST", "/api/diff");
  check("POST /api/diff clean baseline", diffClean.status === 200 && diffClean.data.files.length === 0, `${diffClean.data?.files?.length} files`);
  fs.writeFileSync(path.join(workspace, "src", "hello.js"), "export const hi = 2;\nexport const more = 3;\n");
  const diffDirty = await json("POST", "/api/diff");
  check("POST /api/diff detects change", diffDirty.status === 200 && diffDirty.data.counts.modified === 1 && diffDirty.data.additions >= 1, JSON.stringify(diffDirty.data?.counts));

  const commands = await json("GET", "/api/commands");
  check("GET /api/commands", commands.status === 200 && commands.data.commands.length >= 5, `${commands.data?.commands?.length} commands`);

  const cmd = await json("POST", "/api/command", { command: "node version" });
  check("POST /api/command runs allowlisted", cmd.status === 200 && cmd.data.code === 0, `exit ${cmd.data?.code}`);

  const denied = await json("POST", "/api/command", { command: "rm -rf /" });
  check("POST /api/command rejects arbitrary shell", denied.status === 403, `status ${denied.status}`);

  const sub = await json("POST", "/api/subagents", { name: "Smoke Reviewer", role: "reviewer", adapter: "mock" });
  check("POST /api/subagents", sub.status === 201 && sub.data.subagent.name === "Smoke Reviewer", `status ${sub.status}`);
  const subList = await json("GET", "/api/subagents");
  check("GET /api/subagents", subList.status === 200 && subList.data.subagents.some((s) => s.name === "Smoke Reviewer"), `${subList.data?.subagents?.length} sub-agents`);

  const task = await json("POST", "/api/tasks", { title: "smoke task", agent: "mock", prompt: "do a thing" });
  check("POST /api/tasks", task.status === 201 && ["pending", "running", "completed"].includes(task.data.task.status), JSON.stringify(task.data?.task?.status));
  await new Promise((r) => setTimeout(r, 700));
  const tasks = await json("GET", "/api/tasks");
  check("task scheduler executes", tasks.status === 200 && tasks.data.tasks.some((t) => t.status === "completed"), JSON.stringify(tasks.data?.stats));

  const mcpAdd = await json("POST", "/api/mcp/servers", { name: "smoke-mcp", command: "node", args: ["-e", "0"], trust: "untrusted" });
  check("POST /api/mcp/servers", mcpAdd.status === 201 && mcpAdd.data.server.name === "smoke-mcp", `status ${mcpAdd.status}`);
  const mcpList = await json("GET", "/api/mcp/servers");
  check("GET /api/mcp/servers", mcpList.status === 200 && mcpList.data.servers.length === 1, `${mcpList.data?.servers?.length} servers`);
  const mcpDel = await json("DELETE", `/api/mcp/servers/${mcpAdd.data.server.id}`);
  check("DELETE /api/mcp/servers/:id", mcpDel.status === 200 && mcpDel.data.servers.length === 0, `${mcpDel.data?.servers?.length} after delete`);

  const prompt = await json("GET", "/api/system-prompt");
  check("GET /api/system-prompt", prompt.status === 200 && prompt.data.corePrompt.length > 50, `v${prompt.data?.version}`);
  const promptPut = await json("PUT", "/api/system-prompt", { customInstructions: "Prefer tests first." });
  check("PUT /api/system-prompt", promptPut.status === 200 && promptPut.data.customInstructions === "Prefer tests first.", `v${promptPut.data?.version}`);

  const markup = await json("POST", "/api/prices/markup", { markup: 2.0 });
  check("POST /api/prices/markup", markup.status === 200 && markup.data.markup === 2, `markup ${markup.data?.markup}`);

  const audit = await json("GET", "/api/audit");
  check("GET /api/audit has records", audit.status === 200 && audit.data.records.length >= 1, `${audit.data?.records?.length} records`);

  const sse = await new Promise((resolve) => {
    const controller = new AbortController();
    let buffer = "";
    const timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: "timeout" }); }, 3000);
    fetch(base + "/api/events", { signal: controller.signal }).then(async (res) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("event: connected")) { clearTimeout(timer); controller.abort(); resolve({ ok: true }); return; }
        pump();
      };
      pump().catch(() => {});
    }).catch(() => { clearTimeout(timer); resolve({ ok: false, reason: "fetch failed" }); });
  });
  check("GET /api/events streams SSE", sse.ok === true, sse.reason || "");

  process.stdout.write("────────────────\n");
  process.stdout.write(`  ${passed}/${passed + failures.length} smoke checks passed\n\n`);

  services.orchestrator.cancelAll();
  await services.mcp.closeAll().catch(() => {});
  services.bus.close();
  services.store.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });

  if (failures.length) { process.stderr.write(`smoke failed: ${failures.join(", ")}\n`); process.exit(1); }
}

main().catch((error) => { process.stderr.write(`smoke crashed: ${error.stack || error.message}\n`); process.exit(1); });
