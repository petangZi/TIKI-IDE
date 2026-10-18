// src/mcp/client.mjs
// Dependency-free MCP client over stdio (newline-delimited JSON-RPC 2.0).
// Supports initialize, tools/list, tools/call, resources/list, prompts/list.
// Server descriptions and outputs are treated as untrusted data.
import { spawn } from "node:child_process";
import { redactValue, redactString } from "../security/redact.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT = 20_000;
const MAX_MESSAGE_BYTES = 1_000_000;

class McpConnection {
  constructor(spec, { logger }) {
    this.spec = spec;
    this.logger = logger;
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
    if (this.child) return;
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
      clientInfo: { name: "tiki-ide", version: "1.0.0" }
    }, { timeoutMs: 15_000 });
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
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "MCP error"));
        else resolve(msg.result);
      }
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

export function createMcpManager({ store, logger = console, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const connections = new Map(); // serverId -> McpConnection

  function doc() { return store.load("mcp", { version: 1, servers: [] }); }
  function persist(d) { return store.save("mcp", d); }

  function validateServer(input) {
    if (!input || typeof input.command !== "string" || !input.command.trim()) throw new Error("MCP server requires a command");
    if (input.args !== undefined && !Array.isArray(input.args)) throw new Error("MCP args must be an array");
    return {
      id: input.id || crypto.randomUUID(),
      name: String(input.name || input.command).slice(0, 80),
      command: input.command.trim(),
      args: (input.args || []).map(String).slice(0, 40),
      cwd: input.cwd ? String(input.cwd) : undefined,
      enabled: input.enabled !== false,
      trust: input.trust === "trusted" ? "trusted" : "untrusted",
      created_at: new Date().toISOString()
    };
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

  async function connect(id) {
    const server = getServer(id);
    if (!server) throw new Error("MCP server not found");
    if (!server.enabled) throw new Error("MCP server is disabled");
    if (connections.has(id) && connections.get(id).status === "connected") return connections.get(id);
    const conn = new McpConnection(server, { logger });
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

  return { listServers, addServer, removeServer, getServer, connect, disconnect, describe, callTool, closeAll, connections };
}
