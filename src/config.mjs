// src/config.mjs
// Central, validated configuration. Every module reads config from here —
// no ad-hoc process.env scattered across the codebase.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off", ""]);

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw new ConfigError(`Invalid boolean value: ${JSON.stringify(value)}`);
}

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new ConfigError(`Invalid integer: ${JSON.stringify(value)}`);
  if (n < min || n > max) throw new ConfigError(`Integer out of range [${min}, ${max}]: ${n}`);
  return n;
}

function str(value, fallback = "") {
  return value === undefined ? fallback : String(value);
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.code = "CONFIG_ERROR";
  }
}

function defaultConfigDir() {
  if (process.env.TIKI_CONFIG_DIR) return process.env.TIKI_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "TIKI", "IDE");
  return path.join(os.homedir(), ".config", "tiki-ide");
}

function workspaceFrom(argv = [], env = {}) {
  const fromArgv = argv.find((x) => x.startsWith("--workspace="))?.split("=").slice(1).join("=");
  return env.TIKI_WORKSPACE || fromArgv || process.cwd();
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig({ env = process.env, argv = process.argv.slice(2) } = {}) {
  const host = str(env.TIKI_HOST, "127.0.0.1");
  const allowRemote = bool(env.TIKI_ALLOW_REMOTE, false);
  const authToken = str(env.TIKI_AUTH_TOKEN, "").trim();
  const isLoopback = LOOPBACK.has(host) || host.startsWith("127.");

  // Safety: never bind beyond loopback without both an explicit opt-in and a token.
  if (!isLoopback) {
    if (!allowRemote) {
      throw new ConfigError(
        `Refusing to bind to ${host}: set TIKI_ALLOW_REMOTE=1 to enable non-loopback binding.`
      );
    }
    if (authToken.length < 16) {
      throw new ConfigError(
        "Remote mode requires TIKI_AUTH_TOKEN with at least 16 characters."
      );
    }
  }

  const workspaceInput = workspaceFrom(argv, env);
  const workspace = fs.realpathSync(path.resolve(workspaceInput));
  if (!fs.statSync(workspace).isDirectory()) throw new ConfigError(`Workspace is not a directory: ${workspace}`);

  const configDir = path.resolve(defaultConfigDir());
  const dataDir = path.resolve(str(env.TIKI_DATA_DIR, path.join(configDir, "data")));

  const allowlist = str(env.TIKI_TOOL_HTTP_ALLOWLIST, "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return Object.freeze({
    host,
    port: int(env.TIKI_PORT, 4317, { min: 0, max: 65535 }),
    isLoopback,
    allowRemote,
    authToken,
    remoteAuthEnabled: !isLoopback && authToken.length > 0,
    workspace,
    configDir,
    dataDir,
    logLevel: str(env.TIKI_LOG_LEVEL, "info"),
    maxBodyBytes: int(env.TIKI_MAX_BODY, 1_000_000, { min: 1024, max: 50_000_000 }),
    maxFileBytes: int(env.TIKI_MAX_FILE, 1_000_000, { min: 1024, max: 50_000_000 }),
    currency: str(env.TIKI_CURRENCY, "USD").toUpperCase(),
    agents: {
      opencode: { url: str(env.OPENCODE_URL, "http://127.0.0.1:4096").replace(/\/$/, ""), bin: str(env.OPENCODE_BIN, "opencode") },
      hermes: {
        url: str(env.HERMES_URL, "http://127.0.0.1:8642/v1").replace(/\/$/, ""),
        apiKey: str(env.HERMES_API_KEY, ""),
        model: str(env.HERMES_MODEL, "hermes-agent")
      },
      openclaw: {
        url: str(env.OPENCLAW_URL, "http://127.0.0.1:18789/v1").replace(/\/$/, ""),
        apiKey: str(env.OPENCLAW_API_KEY, ""),
        model: str(env.OPENCLAW_MODEL, "openclaw/default")
      }
    },
    toolHttpAllowlist: allowlist
  });
}
