// tests/unit/mcp-builtins.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../../src/storage/store.mjs";
import { createMcpManager, parseHttpMcpBody } from "../../src/mcp/client.mjs";
import { BUILTIN_MCP_SERVERS, listBuiltins, getBuiltin, resolveBuiltin, expandEnv, missingEnv } from "../../src/mcp/builtins.mjs";

const EXPECTED_IDS = ["rea", "agent-reach", "supabase", "firebase", "flutter", "bolt", "context7", "brave-search", "frontend-inspo", "magic", "lightswind"];

async function withManager(fn) {
  const dir = await mkdtemp(join(tmpdir(), "tiki-mcp-"));
  try {
    const store = createStore({ dataDir: dir });
    const mcp = createMcpManager({ store, logger: { warn() {}, info() {}, debug() {} } });
    return await fn(mcp);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("catalog exposes all eleven built-ins", () => {
  const ids = BUILTIN_MCP_SERVERS.map((e) => e.id);
  for (const id of EXPECTED_IDS) assert.ok(ids.includes(id), `missing builtin: ${id}`);
  const listed = listBuiltins();
  assert.equal(listed.length, 11);
  for (const entry of listed) {
    assert.equal(typeof entry.name, "string");
    assert.ok(["stdio", "http", "bundle"].includes(entry.transport));
    assert.equal(typeof entry.ready, "boolean");
    assert.ok(Array.isArray(entry.missingEnv));
  }
});

test("getBuiltin resolves variants too", () => {
  assert.equal(getBuiltin("firebase").id, "firebase");
  assert.equal(getBuiltin("SUPABASE").id, "supabase");
  assert.equal(getBuiltin("bolt-http").transport, "http");
  assert.equal(getBuiltin("nope"), null);
});

test("firebase resolves to the firebase-tools mcp stdio command", () => {
  const rec = resolveBuiltin("firebase");
  assert.equal(rec.transport, "stdio");
  assert.equal(rec.command, "npx");
  assert.deepEqual(rec.args, ["-y", "firebase-tools", "mcp", "--dir", "."]);
  assert.equal(rec.trust, "untrusted");
  assert.equal(rec.builtin, true);
});

test("${ENV} placeholders expand and required env is reported", () => {
  assert.equal(expandEnv("--token", {}), "--token");
  assert.equal(expandEnv("Bearer ${T}", { T: "abc" }), "Bearer abc");
  const entry = getBuiltin("supabase");
  assert.deepEqual(missingEnv(entry, {}), ["SUPABASE_ACCESS_TOKEN"]);
  assert.deepEqual(missingEnv(entry, { SUPABASE_ACCESS_TOKEN: "x" }), []);
});

test("supabase stdio install substitutes the access token", () => {
  const rec = resolveBuiltin("supabase", { env: { SUPABASE_ACCESS_TOKEN: "sbp_secret" } });
  assert.equal(rec.transport, "stdio");
  assert.ok(rec.args.includes("sbp_secret"));
  assert.ok(rec.args.includes("--access-token"));
  assert.equal(rec.env.SUPABASE_ACCESS_TOKEN, "sbp_secret");
});

test("supabase remote variant builds a bearer header from the token", () => {
  const rec = resolveBuiltin("supabase-remote", { env: { SUPABASE_ACCESS_TOKEN: "sbp_secret" } });
  assert.equal(rec.transport, "http");
  assert.ok(rec.url.startsWith("https://mcp.supabase.com/mcp"));
  assert.equal(rec.headers.Authorization, "Bearer sbp_secret");
});

test("agent-reach is a bundle and refuses direct install", () => {
  assert.equal(getBuiltin("agent-reach").transport, "bundle");
  assert.throws(() => resolveBuiltin("agent-reach"), /bundle/);
});

test("listBuiltins flags readiness from the environment", () => {
  const withToken = listBuiltins({ source: { SUPABASE_ACCESS_TOKEN: "x" } });
  const supabase = withToken.find((e) => e.id === "supabase");
  assert.equal(supabase.ready, true);
  const noToken = listBuiltins({ source: {} });
  assert.equal(noToken.find((e) => e.id === "supabase").ready, false);
});

test("parseHttpMcpBody handles plain JSON and SSE frames", () => {
  const json = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  assert.deepEqual(parseHttpMcpBody(json, "application/json", 1).result, { ok: true });
  const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { n: 2 } })}\n\n`;
  assert.deepEqual(parseHttpMcpBody(sse, "text/event-stream", 2).result, { n: 2 });
});

test("manager install persists a built-in and marks it installed", async () => {
  await withManager((mcp) => {
    const server = mcp.installBuiltin("flutter");
    assert.equal(server.id, "flutter");
    assert.equal(server.transport, "stdio");
    const listed = mcp.listBuiltins();
    assert.equal(listed.find((e) => e.id === "flutter").installed, true);
    assert.equal(listed.find((e) => e.id === "rea").installed, false);
    // idempotent
    const again = mcp.installBuiltin("flutter");
    assert.equal(again.id, "flutter");
    assert.equal(mcp.listServers().length, 1);
  });
});

test("research-driven built-ins resolve to real launch specs", () => {
  const brave = resolveBuiltin("brave-search");
  assert.equal(brave.command, "npx");
  assert.deepEqual(brave.args, ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]);

  const magic = resolveBuiltin("magic", { env: { API_KEY_21ST: "k" } });
  assert.deepEqual(magic.args, ["-y", "@21st-dev/magic@latest"]);
  assert.equal(magic.env.API_KEY_21ST, "k");
  const magicRemote = resolveBuiltin("magic-remote", { env: { API_KEY_21ST: "k" } });
  assert.equal(magicRemote.url, "https://21st.dev/api/mcp");
  assert.equal(magicRemote.headers["x-api-key"], "k");

  // Published CLI declares only fs-extra, so the two extras it requires at
  // runtime have to be pulled in alongside it or the server dies on load.
  assert.deepEqual(resolveBuiltin("lightswind").args, ["-y", "-p", "lightswind@latest", "-p", "@modelcontextprotocol/sdk", "-p", "fuse.js", "lightswind", "mcp"]);
  assert.deepEqual(resolveBuiltin("frontend-inspo").args, ["-y", "frontend-inspo-mcp"]);
  assert.equal(resolveBuiltin("context7-remote", { env: { CONTEXT7_API_KEY: "k" } }).headers.Authorization, "Bearer k");
});

test("key-gated built-ins report readiness correctly", () => {
  assert.equal(listBuiltins({ source: {} }).find((e) => e.id === "brave-search").ready, false);
  assert.equal(listBuiltins({ source: { BRAVE_API_KEY: "x" } }).find((e) => e.id === "brave-search").ready, true);
  assert.equal(listBuiltins({ source: {} }).find((e) => e.id === "frontend-inspo").ready, true);
});

test("updateServer toggles trust without touching the launch spec", async () => {
  await withManager((mcp) => {
    mcp.installBuiltin("context7");
    const before = mcp.getServer("context7");
    assert.equal(before.trust, "untrusted");
    const updated = mcp.updateServer("context7", { trust: "trusted" });
    assert.equal(updated.trust, "trusted");
    assert.equal(updated.command, before.command);
    assert.deepEqual(updated.args, before.args);
    assert.equal(mcp.updateServer("context7", { trust: "whatever" }).trust, "untrusted");
    assert.throws(() => mcp.updateServer("ghost", { trust: "trusted" }), /not found/);
  });
});

test("manager rejects an unknown built-in", async () => {
  await withManager((mcp) => {
    assert.throws(() => mcp.installBuiltin("does-not-exist"), /Unknown built-in/);
  });
});

test("http transport talks to a live MCP endpoint end-to-end", async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body || "{}");
      res.setHeader("content-type", "application/json");
      if (msg.method === "initialize") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1" } } }));
      }
      if (msg.method === "tools/list") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object" } }] } }));
      }
      if (msg.method === "tools/call") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "pong" }] } }));
      }
      res.statusCode = 202;
      res.end("");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await withManager(async (mcp) => {
      const record = mcp.addServer({ id: "fake", name: "Fake", transport: "http", url: `http://127.0.0.1:${port}/mcp`, trust: "trusted" });
      assert.equal(record.transport, "http");
      assert.equal(record.command, undefined);
      const described = await mcp.describe("fake");
      assert.equal(described.tools[0].name, "ping");
      assert.equal(described.serverInfo.name, "fake-mcp");
      const out = await mcp.callTool("fake", "ping", {});
      assert.equal(out.content[0].text, "pong");
      await mcp.disconnect("fake");
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("http server validation rejects bad urls", () => {
  const store = { load: () => ({ version: 1, servers: [] }), save: () => {} };
  const mcp = createMcpManager({ store, logger: { warn() {} } });
  assert.throws(() => mcp.addServer({ transport: "http" }), /requires a url/);
  assert.throws(() => mcp.addServer({ transport: "http", url: "ftp://x/y" }), /http or https/);
  const ok = mcp.addServer({ id: "s", transport: "http", url: "https://example.com/mcp" });
  assert.equal(ok.url, "https://example.com/mcp");
});
