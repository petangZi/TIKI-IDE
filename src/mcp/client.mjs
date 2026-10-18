// src/mcp/client.mjs
// Dependency-free MCP client with two transports:
//   - stdio: newline-delimited JSON-RPC 2.0 over a child process
//   - http:  Streamable HTTP JSON-RPC (JSON or text/event-stream responses)
// Supports initialize, tools/list, tools/call, resources/list, prompts/list.
// Server descriptions and outputs are treated as untrusted data.
import { spawn } from "node:child_process";
import { redactValue, redactString } from "../security/redact.mjs";
import { listBuiltins as listBuiltinCatalog, resolveBuiltin } from "./builtins.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT = 20_000;
// npx-launched servers can take a minute to cold-start (registry resolution +
// first download), so the handshake gets a much larger budget than calls.
const DEFAULT_INIT_TIMEOUT = 90_000;
const MAX_MESSAGE_BYTES = 1_000_000;

const CLIENT_INFO = { name: "tiki-ide", version: "1.0.0" };

function nowIso() { return new Date().toISOString(); }

class StdioConnection {
  constructor(spec, { logger, initTimeoutMs = DEFAULT_INIT_TIMEOUT }) {
    this.spec = spec;
    this.logger = logger;
    this.initTimeoutMs = initTimeoutMs;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.capabilities = null;
    this.serverInfo = null;
    this.status = "disconnected";
    this.stderr = [];
  }

  async connect() {
    if (this.child) return { capabilities: this.capabilities, serverInfo: this.serverInfo };
    const { command, args = [], env = {}, cwd } = this.spec;
    this.status = "connecting";
    this.child = spawn(command, args, {
      cwd,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    this.child.on("error", (error) => { this.status = "error"; this.logger?.warn?.("mcp spawn error", { error: error.message, server: this.spec.id }); });
    this.child.on("exit", (code) => { this.status = "disconnected"; this.rejectAll(`server exited (code ${code})`); });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr.push(redactString(String(chunk)).slice(0, 2000));
      if (this.stderr.length > 50) this.stderr.shift();
    });

    const init = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO
    }, { timeoutMs: this.initTimeoutMs });
    this.capabilities = init?.capabilities || {};
    this.serverInfo = init?.serverInfo || null;
    this.notify("notifications/initialized", {});
    this.status = "connected";
    return { capabilities: this.capabilities, serverInfo: this.serverInfo };
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_MESSAGE_BYTES) { this.buffer = ""; this.logger?.warn?.("mcp buffer overflow, dropped", { server: this.spec.id }); return; }
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      this.settle(msg);
    }
  }

  settle(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "MCP error"));
      else resolve(msg.result);
    }
  }

  request(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    if (!this.child) return Promise.reject(new Error("MCP not connected"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(payload); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params = {}) {
    if (!this.child) return;
    try { this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); } catch {}
  }

  rejectAll(reason) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error(reason)); }
    this.pending.clear();
  }

  async listTools() { return (await this.request("tools/list", {})).tools || []; }
  async listResources() { return (await this.request("resources/list", {})).resources || []; }
  async listPrompts() { return (await this.request("prompts/list", {})).prompts || []; }
  async callTool(name, args = {}, { timeoutMs = DEFAULT_TIMEOUT } = {}) { return this.request("tools/call", { name, arguments: args }, { timeoutMs }); }

  async close() {
    this.rejectAll("client closed");
    this.status = "disconnected";
    if (this.child) { try { this.child.kill("SIGTERM"); } catch {} this.child = null; }
  }
}

/** Parse a Streamable-HTTP response body into the JSON-RPC message for `id`. */
export function parseHttpMcpBody(text, contentType = "", id) {
  const type = String(contentType).toLowerCase();
  if (type.includes("text/event-stream") || /^\s*(event|data):/m.test(text)) {
    let match = null;
    for (const block of text.split(/\n\n+/)) {
      const dataLines = block.split(/\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      let msg; try { msg = JSON.parse(dataLines.join("\n")); } catch { continue; }
      if (id === undefined || msg.id === id) match = msg;
    }
    return match;
  }
  return JSON.parse(text);
}

class HttpConnection {
  constructor(spec, { logger, initTimeoutMs = DEFAULT_INIT_TIMEOUT }) {
    this.spec = spec;
    this.logger = logger;
    this.initTimeoutMs = initTimeoutMs;
    this.url = spec.url;
    this.nextId = 1;
    this.capabilities = null;
    this.serverInfo = null;
    this.status = "disconnected";
    this.stderr = [];
  }

  headers() {
    const base = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION
    };
    return { ...base, ...(this.spec.headers || {}) };
  }

  async post(message, { timeoutMs = DEFAULT_TIMEOUT, expectReply = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(message),
        signal: controller.signal
      });
      const text = await res.text();
      if (text.length > MAX_MESSAGE_BYTES) throw new Error("MCP HTTP response too large");
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (!expectReply && res.status === 404) return null; // notification endpoints may 404
        throw new Error(`MCP HTTP ${res.status}: ${redactString(text).slice(0, 300)}`);
      }
      if (!expectReply) return null;
      if (!text.trim()) return null;
      const msg = parseHttpMcpBody(text, contentType, message.id);
      if (!msg) return null;
      if (msg.error) throw new Error(msg.error.message || "MCP error");
      return msg.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect() {
    this.status = "connecting";
    const init = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "initialize", params: {
      protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO
    } }, { timeoutMs: this.initTimeoutMs });
    this.capabilities = init?.capabilities || {};
    this.serverInfo = init?.serverInfo || null;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, { expectReply: false }).catch(() => {});
    this.status = "connected";
    return { capabilities: this.capabilities, serverInfo: this.serverInfo };
  }

  request(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    return this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, { timeoutMs, expectReply: true });
  }

  notify(method, params = {}) {
    this.post({ jsonrpc: "2.0", method, params }, { expectReply: false }).catch(() => {});
  }

  async listTools() { return (await this.request("tools/list", {}))?.tools || []; }
  async listResources() { return (await this.request("resources/list", {}))?.resources || []; }
  async listPrompts() { return (await this.request("prompts/list", {}))?.prompts || []; }
  async callTool(name, args = {}, { timeoutMs = DEFAULT_TIMEOUT } = {}) { return this.request("tools/call", { name, arguments: args }, { timeoutMs }); }

  async close() { this.status = "disconnected"; }
}

function makeConnection(spec, deps) {
  return spec.transport === "http" ? new HttpConnection(spec, deps) : new StdioConnection(spec, deps);
}

export function createMcpManager({ store, logger = console, timeoutMs = DEFAULT_TIMEOUT, initTimeoutMs = DEFAULT_INIT_TIMEOUT } = {}) {
  const connections = new Map(); // serverId -> connection

  function doc() { return store.load("mcp", { version: 1, servers: [] }); }
  function persist(d) { return store.save("mcp", d); }

  function normalizeTransport(input) {
    if (input.transport === "http") return "http";
    if (input.url && !input.command) return "http";
    return "stdio";
  }

  function validateServer(input) {
    const transport = normalizeTransport(input);
    const base = {
      id: input.id || crypto.randomUUID(),
      name: String(input.name || input.command || input.url || "mcp").slice(0, 80),
      transport,
      enabled: input.enabled !== false,
      trust: input.trust === "trusted" ? "trusted" : "untrusted",
      created_at: nowIso()
    };
    if (input.builtin === true) base.builtin = true;
    if (input.docs) base.docs = String(input.docs);
    if (transport === "http") {
      if (typeof input.url !== "string" || !input.url.trim()) throw new Error("HTTP MCP server requires a url");
      let parsed; try { parsed = new URL(input.url.trim()); } catch { throw new Error("MCP url is not a valid URL"); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("MCP url must be http or https");
      base.url = parsed.toString();
      base.headers = input.headers && typeof input.headers === "object"
        ? Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [String(k), String(v)]))
        : undefined;
      return base;
    }
    if (typeof input.command !== "string" || !input.command.trim()) throw new Error("MCP server requires a command");
    if (input.args !== undefined && !Array.isArray(input.args)) throw new Error("MCP args must be an array");
    base.command = input.command.trim();
    base.args = (input.args || []).map(String).slice(0, 40);
    base.cwd = input.cwd ? String(input.cwd) : undefined;
    base.env = input.env && typeof input.env === "object"
      ? Object.fromEntries(Object.entries(input.env).map(([k, v]) => [String(k), String(v)]))
      : undefined;
    return base;
  }

  function listServers() {
    return doc().servers.map((s) => {
      const conn = connections.get(s.id);
      return { ...s, status: conn ? conn.status : "disconnected", serverInfo: conn?.serverInfo || null, toolCount: null };
    });
  }

  function addServer(input) {
    const d = doc();
    const server = validateServer(input);
    if (d.servers.some((s) => s.id === server.id)) throw new Error("MCP server id already exists");
    d.servers.push(server);
    persist(d);
    return server;
  }

  function removeServer(id) {
    const conn = connections.get(id);
    if (conn) { conn.close(); connections.delete(id); }
    const d = doc();
    const next = d.servers.filter((s) => s.id !== id);
    if (next.length === d.servers.length) throw new Error("MCP server not found");
    d.servers = next;
    persist(d);
    return listServers();
  }

  function getServer(id) {
    return doc().servers.find((s) => s.id === id) || null;
  }

  function updateServer(id, patch = {}) {
    const d = doc();
    const server = d.servers.find((s) => s.id === id);
    if (!server) throw new Error("MCP server not found");
    if (patch.trust !== undefined) server.trust = patch.trust === "trusted" ? "trusted" : "untrusted";
    if (patch.enabled !== undefined) server.enabled = patch.enabled !== false;
    if (patch.name !== undefined) server.name = String(patch.name).slice(0, 80);
    // Some servers (bolt) must run from a checkout the user made, so the
    // working directory has to be settable after install.
    if (patch.cwd !== undefined) {
      if (server.transport !== "stdio") throw new Error("cwd only applies to stdio servers");
      server.cwd = patch.cwd ? String(patch.cwd) : undefined;
    }
    persist(d);
    return server;
  }

  function listBuiltins() {
    const installed = new Set(doc().servers.map((s) => s.id));
    return listBuiltinCatalog().map((entry) => ({
      ...entry,
      installed: installed.has(entry.id),
      children: (entry.children || []).map((c) => ({ ...c, installed: installed.has(c.id) })),
      variants: (entry.variants || []).map((v) => ({ ...v, installed: installed.has(v.id) }))
    }));
  }

  function installBuiltin(id, options = {}) {
    const record = resolveBuiltin(id, options);
    const d = doc();
    if (d.servers.some((s) => s.id === record.id)) return getServer(record.id);
    const server = validateServer(record);
    d.servers.push(server);
    persist(d);
    return server;
  }

  async function connect(id) {
    const server = getServer(id);
    if (!server) throw new Error("MCP server not found");
    if (!server.enabled) throw new Error("MCP server is disabled");
    if (connections.has(id) && connections.get(id).status === "connected") return connections.get(id);
    const conn = makeConnection(server, { logger, initTimeoutMs });
    connections.set(id, conn);
    try { await conn.connect(); return conn; }
    catch (error) { connections.delete(id); await conn.close(); throw error; }
  }

  async function disconnect(id) {
    const conn = connections.get(id);
    if (conn) { await conn.close(); connections.delete(id); }
    return { id, status: "disconnected" };
  }

  async function describe(id) {
    const conn = await connect(id);
    const [tools, resources, prompts] = await Promise.all([
      conn.listTools().catch(() => []),
      conn.listResources().catch(() => []),
      conn.listPrompts().catch(() => [])
    ]);
    return {
      id,
      serverInfo: conn.serverInfo,
      capabilities: conn.capabilities,
      tools: tools.map((t) => ({ name: t.name, description: redactString(String(t.description || "")).slice(0, 500), inputSchema: t.inputSchema || null })),
      resources: resources.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType })),
      prompts: prompts.map((p) => ({ name: p.name, description: p.description }))
    };
  }

  async function callTool(id, name, args = {}) {
    const server = getServer(id);
    if (!server) throw new Error("MCP server not found");
    if (server.trust !== "trusted") throw new Error("MCP server is untrusted; mark it trusted to invoke tools");
    const conn = await connect(id);
    const result = await conn.callTool(name, args, { timeoutMs });
    return redactValue(result);
  }

  async function closeAll() {
    for (const [id, conn] of connections) { try { await conn.close(); } catch {} connections.delete(id); }
  }

  return { listServers, addServer, removeServer, getServer, updateServer, listBuiltins, installBuiltin, connect, disconnect, describe, callTool, closeAll, connections };
}
