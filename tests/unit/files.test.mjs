import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspace, WorkspaceError, hashText } from "../../src/workspace/files.mjs";

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-files-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "a.txt"), "hello\nworld\n");
  return { root, ws: createWorkspace({ root }) };
}

test("listTree returns relative entries", () => {
  const { root, ws } = makeWorkspace();
  const tree = ws.listTree(".");
  assert.ok(tree.entries.some((e) => e.path === "src/a.txt" && e.type === "file"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("readFile returns content and hash", () => {
  const { root, ws } = makeWorkspace();
  const file = ws.readFile("src/a.txt");
  assert.equal(file.content, "hello\nworld\n");
  assert.equal(file.hash, hashText("hello\nworld\n"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("readFile flags binary content", () => {
  const { root, ws } = makeWorkspace();
  fs.writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  const file = ws.readFile("blob.bin");
  assert.equal(file.binary, true);
  assert.equal(file.content, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("writeFile refuses traversal outside the root", () => {
  const { root, ws } = makeWorkspace();
  assert.throws(() => ws.writeFile("../escape.txt", "x", { create: true }), (e) => e instanceof WorkspaceError && e.code === "PATH_ESCAPE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("writeFile create:false refuses to create new files", () => {
  const { root, ws } = makeWorkspace();
  assert.throws(() => ws.writeFile("src/new.txt", "x"), (e) => e.code === "NOT_FOUND");
  fs.rmSync(root, { recursive: true, force: true });
});

test("writeFile detects stale hash conflicts", () => {
  const { root, ws } = makeWorkspace();
  assert.throws(() => ws.writeFile("src/a.txt", "changed", { expectHash: "deadbeefdeadbeef" }), (e) => e.code === "CONFLICT");
  fs.rmSync(root, { recursive: true, force: true });
});

test("remove refuses to delete the workspace root", () => {
  const { root, ws } = makeWorkspace();
  assert.throws(() => ws.remove("."), (e) => e.code === "FORBIDDEN");
  fs.rmSync(root, { recursive: true, force: true });
});

test("search finds matching lines", () => {
  const { root, ws } = makeWorkspace();
  const result = ws.search("world");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].path, "src/a.txt");
  fs.rmSync(root, { recursive: true, force: true });
});
