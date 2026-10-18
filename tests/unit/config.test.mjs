import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, ConfigError } from "../../src/config.mjs";

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "tiki-config-"));

test("loopback bind is open by default", () => {
  const config = loadConfig({ env: { TIKI_WORKSPACE: workspace(), TIKI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "tiki-d-")) }, argv: [] });
  assert.equal(config.isLoopback, true);
  assert.equal(config.remoteAuthEnabled, false);
});

test("non-loopback bind requires explicit opt-in", () => {
  assert.throws(
    () => loadConfig({ env: { TIKI_HOST: "0.0.0.0", TIKI_WORKSPACE: workspace() }, argv: [] }),
    (e) => e instanceof ConfigError && /TIKI_ALLOW_REMOTE/.test(e.message)
  );
});

test("remote bind with a short token is rejected", () => {
  assert.throws(
    () => loadConfig({ env: { TIKI_HOST: "0.0.0.0", TIKI_ALLOW_REMOTE: "1", TIKI_AUTH_TOKEN: "short", TIKI_WORKSPACE: workspace() }, argv: [] }),
    (e) => e instanceof ConfigError && /at least 16/.test(e.message)
  );
});

test("remote bind with a strong token enables auth", () => {
  const config = loadConfig({
    env: { TIKI_HOST: "0.0.0.0", TIKI_ALLOW_REMOTE: "1", TIKI_AUTH_TOKEN: "0123456789abcdef", TIKI_WORKSPACE: workspace(), TIKI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "tiki-d-")) },
    argv: []
  });
  assert.equal(config.remoteAuthEnabled, true);
});

test("invalid integer env is rejected", () => {
  assert.throws(() => loadConfig({ env: { TIKI_PORT: "not-a-port", TIKI_WORKSPACE: workspace() }, argv: [] }), (e) => e instanceof ConfigError);
});

test("invalid boolean env is rejected", () => {
  assert.throws(() => loadConfig({ env: { TIKI_ALLOW_REMOTE: "maybe", TIKI_WORKSPACE: workspace() }, argv: [] }), (e) => e instanceof ConfigError);
});

test("config is frozen", () => {
  const config = loadConfig({ env: { TIKI_WORKSPACE: workspace(), TIKI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "tiki-d-")) }, argv: [] });
  assert.equal(Object.isFrozen(config), true);
});

test("MCP timeouts have safe defaults and accept overrides", () => {
  const base = loadConfig({ env: { TIKI_WORKSPACE: workspace(), TIKI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "tiki-d-")) }, argv: [] });
  assert.equal(base.mcpInitTimeoutMs, 90_000);
  assert.equal(base.mcpTimeoutMs, 30_000);
  const custom = loadConfig({ env: { TIKI_WORKSPACE: workspace(), TIKI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "tiki-d-")), TIKI_MCP_INIT_TIMEOUT_MS: "120000", TIKI_MCP_TIMEOUT_MS: "5000" }, argv: [] });
  assert.equal(custom.mcpInitTimeoutMs, 120_000);
  assert.equal(custom.mcpTimeoutMs, 5_000);
  assert.throws(() => loadConfig({ env: { TIKI_WORKSPACE: workspace(), TIKI_MCP_INIT_TIMEOUT_MS: "0" }, argv: [] }), (e) => e instanceof ConfigError);
});
