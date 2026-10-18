// src/api/routes/workspace.mjs
import { spawn } from "node:child_process";
import { ApiError } from "../respond.mjs";

export function registerWorkspaceRoutes(router, services) {
  const { workspace, snapshots, bus, policy, audit } = services;
  let diffBaseline = null;

  router.get("/api/tree", (ctx) => workspace.listTree(ctx.query.get("path") || ".", { depth: Number(ctx.query.get("depth")) || 6 }));
  router.get("/api/file", (ctx) => workspace.readFile(ctx.query.get("path") || ""));
  router.get("/api/search", (ctx) => {
    const q = ctx.query.get("q");
    if (!q) throw new ApiError("q is required", 400, "BAD_INPUT");
    return workspace.search(q, { caseSensitive: ctx.query.get("case") === "1", maxResults: Number(ctx.query.get("limit")) || 200 });
  });
  router.get("/api/stat", (ctx) => workspace.stat(ctx.query.get("path") || "."));

  router.post("/api/file", async (ctx) => {
    const body = await ctx.readBody();
    if (typeof body.path !== "string" || typeof body.content !== "string") throw new ApiError("Expected path and content strings", 400, "BAD_INPUT");
    const result = workspace.writeFile(body.path, body.content, { expectHash: body.expectHash || null, create: body.create !== false });
    bus.emitSafe({ type: result.created ? "file.created" : "file.changed", payload: { path: result.path }, text: `${result.created ? "Created" : "Saved"} ${result.path}` });
    audit.record({ actor: "user", action: result.created ? "file.create" : "file.write", target: result.path });
    return result;
  });

  router.post("/api/file/rename", async (ctx) => {
    const body = await ctx.readBody();
    if (typeof body.from !== "string" || typeof body.to !== "string") throw new ApiError("Expected from and to", 400, "BAD_INPUT");
    const result = workspace.rename(body.from, body.to);
    bus.emitSafe({ type: "file.changed", payload: { path: result.to, renamed_from: result.from }, text: `Renamed ${result.from} -> ${result.to}` });
    audit.record({ actor: "user", action: "file.rename", target: `${result.from} -> ${result.to}` });
    return result;
  });

  router.delete("/api/file", async (ctx) => {
    const p = ctx.query.get("path");
    if (!p) throw new ApiError("path is required", 400, "BAD_INPUT");
    const result = workspace.remove(p);
    bus.emitSafe({ type: "file.deleted", payload: { path: result.path }, text: `Deleted ${result.path}` });
    audit.record({ actor: "user", action: "file.delete", target: result.path });
    return result;
  });

  router.get("/api/commands", () => ({ commands: policy.listCommands() }));

  router.post("/api/command", async (ctx) => {
    const body = await ctx.readBody();
    const classified = policy.classifyCommand(body.command);
    if (!classified.allowed) throw new ApiError(classified.reason || "Command not allowed", 403, "COMMAND_DENIED");
    const inspection = policy.inspectText(body.command);
    if (inspection.dangerous) throw new ApiError("Command matched a blocked pattern", 403, "COMMAND_DANGEROUS");

    if (classified.approval) {
      bus.emitSafe({ type: "tool.approval_required", text: `Approval required to run: ${body.command}` });
      const decision = await policy.requestApproval({ kind: "command", summary: `Run "${body.command}"`, detail: { command: body.command }, timeoutMs: 120_000 });
      if (!decision.approved) {
        audit.record({ actor: "user", action: "command.denied", target: body.command, result: "denied" });
        throw new ApiError(`Command not approved (${decision.reason || "denied"})`, 403, "COMMAND_NOT_APPROVED");
      }
    }

    const [bin, args] = classified.argv;
    bus.emitSafe({ type: "command.started", text: `Running approved command: ${body.command}` });
    const output = await runCommand(bin, args, workspace.root, 30_000);
    const success = output.code === 0;
    bus.emitSafe({ type: "command.completed", payload: { command: body.command, exit_code: output.code }, text: `Exit code ${output.code}: ${body.command}` });
    audit.record({ actor: "user", action: "command.run", target: body.command, result: success ? "ok" : "error" });
    return { command: body.command, code: output.code, output: output.text.slice(0, 100_000) };
  });

  router.post("/api/snapshot", () => {
    const snap = snapshots.capture({ label: `manual:${new Date().toISOString()}` });
    return { id: snap.id, file_count: snap.file_count, created_at: snap.created_at };
  });

  router.post("/api/diff", async (ctx) => {
    const body = await ctx.readBody().catch(() => ({}));
    if (body.baseline_id) {
      const recorded = snapshots.list?.()?.find?.((s) => s.id === body.baseline_id);
      if (recorded) return snapshots.diffAgainst(recorded);
    }
    if (body.reset === true || !diffBaseline) {
      diffBaseline = snapshots.capture({ label: "diff-baseline", cacheContents: true });
      return { reset: true, snapshot_id: diffBaseline.id, generated_at: new Date().toISOString(), counts: { added: 0, modified: 0, deleted: 0 }, additions: 0, deletions: 0, files: [], truncated: false };
    }
    return snapshots.diffAgainst(diffBaseline);
  });

  router.post("/api/diff/reset", () => {
    diffBaseline = snapshots.capture({ label: "diff-baseline", cacheContents: true });
    return { snapshot_id: diffBaseline.id, file_count: diffBaseline.file_count, created_at: diffBaseline.created_at };
  });
}

function runCommand(bin, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const childEnv = { PATH: process.env.PATH || "", HOME: process.env.HOME || "", LANG: process.env.LANG || "C.UTF-8" };
    if (process.platform === "win32") childEnv.SystemRoot = process.env.SystemRoot || "C:\\Windows";
    let child;
    try {
      child = spawn(bin, args, { cwd, shell: false, windowsHide: true, env: childEnv });
    } catch (error) {
      return resolve({ code: 127, text: String(error.message) });
    }
    let text = "";
    child.stdout?.on("data", (d) => { text += d.toString(); if (text.length > 200_000) child.kill("SIGKILL"); });
    child.stderr?.on("data", (d) => { text += d.toString(); });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: 127, text: String(error.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 0, text }); });
  });
}
