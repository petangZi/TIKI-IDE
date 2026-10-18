import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.mjs";
import { createLogger } from "../../src/logger.mjs";
import { buildServices, createServer } from "../../server.mjs";

async function boot() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-http-ws-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-http-data-"));
  fs.writeFileSync(path.join(workspace, "note.txt"), "note\n");
  const config = loadConfig({ env: { TIKI_WORKSPACE: workspace, TIKI_DATA_DIR: dataDir, TIKI_LOG_LEVEL: "error" }, argv: [] });
  const services = buildServices(config, createLogger("test", "error"));
  const server = createServer(services);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    services.orchestrator.cancelAll();
    services.bus.close();
    services.store.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  const request = async (method, url, body) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["x-tiki-csrf"] = "1";
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  return { services, base, close, request };
}

test("static shell and health endpoint respond", async () => {
  const h = await boot();
  const health = await h.request("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const shell = await fetch(h.base + "/");
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /TIKI Universal IDE/);
  await h.close();
});

test("tree, file read/write, and traversal guard", async () => {
  const h = await boot();
  const tree = await h.request("GET", "/api/tree");
  assert.ok(tree.data.entries.some((e) => e.name === "note.txt"));
  const write = await h.request("POST", "/api/file", { path: "new/x.txt", content: "hi", create: true });
  assert.equal(write.data.created, true);
  const read = await h.request("GET", "/api/file?path=new/x.txt");
  assert.equal(read.data.content, "hi");
  const blocked = await h.request("GET", "/api/file?path=../../../etc/hosts");
  assert.ok([403, 404].includes(blocked.status));
  await h.close();
});

test("chat run produces a diff and a usage record", async () => {
  const h = await boot();
  await h.request("POST", "/api/diff/reset");
  const res = await h.request("POST", "/api/chat", { agent: "mock", prompt: "integration" });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "completed");
  assert.ok(typeof res.data.answer === "string");
  const usage = await h.request("GET", "/api/usage/summary");
  assert.ok(usage.data.records >= 1);
  await h.close();
});

test("tool invoke validates input and returns data", async () => {
  const h = await boot();
  const ok = await h.request("POST", "/api/tools/mock.echo/invoke", { args: { value: "abc" } });
  assert.equal(ok.data.data.echoed, "abc");
  const bad = await h.request("POST", "/api/tools/mock.echo/invoke", { args: {} });
  assert.equal(bad.status, 400);
  await h.close();
});

test("command runner enforces the allowlist", async () => {
  const h = await boot();
  const allowed = await h.request("POST", "/api/command", { command: "node version" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.data.code, 0);
  const denied = await h.request("POST", "/api/command", { command: "cat /etc/passwd" });
  assert.equal(denied.status, 403);
  await h.close();
});

test("unknown route returns 404", async () => {
  const h = await boot();
  const res = await h.request("GET", "/api/nope");
  assert.equal(res.status, 404);
  await h.close();
});
