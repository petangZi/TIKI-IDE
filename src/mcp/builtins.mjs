// src/mcp/builtins.mjs
// Curated catalog of built-in MCP servers. Each entry is a launch spec that can
// be installed into the MCP registry with one call. Nothing here is started
// automatically: entries are untrusted and disabled until explicitly installed.
//
// `args` may contain ${ENV} placeholders, expanded from the process environment
// (or per-install overrides) when the server is installed.

export const BUILTIN_MCP_SERVERS = [
  {
    id: "rea",
    name: "REA — Reverse Engineer Anything",
    description:
      "Reverse-engineering MCP: static analysis of binaries, applications, JS runtimes, firmware, Android, and more. One MCP across native and managed targets.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "rea-agents@6.7.0", "mcp"],
    env: {
      REA_MCP_INPUT_SCHEMA_PROFILE: { required: false, description: "Input schema profile (default: standard)." },
      REA_MCP_OUTPUT_SCHEMA_PROFILE: { required: false, description: "Output schema profile (default: standard)." },
      REA_MCP_MAX_RESPONSE_BYTES: { required: false, description: "Cap on MCP responses in bytes." }
    },
    requires: ["npx"],
    install: "npx rea-agents setup   (or install directly with the command below)",
    docs: "https://github.com/morluto/rea",
    tags: ["reverse-engineering", "binary", "android", "firmware"],
    defaultTrust: "untrusted"
  },
  {
    id: "agent-reach",
    name: "Agent Reach",
    description:
      "Internet-access bundle for agents: installs, health-checks and routes upstream tools (OpenCLI, twitter-cli, yt-dlp, Exa, Jina Reader) and MCP servers. Selector/router, not a single server — installs the child MCP servers below.",
    transport: "bundle",
    install: "pipx install agent-reach && agent-reach install --system",
    docs: "https://github.com/Panniantong/agent-reach",
    tags: ["web", "social", "search", "bundle"],
    defaultTrust: "untrusted",
    children: [
      {
        id: "agent-reach:xiaohongshu",
        name: "xiaohongshu-mcp",
        transport: "http",
        url: "http://localhost:18060/mcp",
        install: "download xiaohongshu-mcp release into ~/.agent-reach/tools/ and start it on :18060",
        docs: "https://github.com/xpzouying/xiaohongshu-mcp",
        requires: ["xiaohongshu-mcp"]
      },
      {
        id: "agent-reach:linkedin",
        name: "mcp-server-linkedin",
        transport: "stdio",
        command: "uvx",
        args: ["mcp-server-linkedin@latest"],
        install: "uvx mcp-server-linkedin@latest --login   (interactive login once)",
        docs: "https://github.com/stickerdaniel/linkedin-mcp-server",
        requires: ["uvx"]
      }
    ],
    note: "Exa search is exposed through `mcporter call exa.web_search_exa`, not a dedicated MCP server."
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "Official Supabase MCP: manage projects, run SQL, inspect schemas, manage branches and edge functions. stdio via npx; a remote HTTP endpoint is also available.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "${SUPABASE_ACCESS_TOKEN}", "--read-only"],
    env: {
      SUPABASE_ACCESS_TOKEN: { required: true, description: "Supabase personal access token (Dashboard → Account → Access Tokens)." }
    },
    requires: ["npx"],
    install: "create a token at https://supabase.com/dashboard/account/tokens, then install below",
    variants: [
      {
        id: "supabase-remote",
        name: "Supabase (remote HTTP)",
        transport: "http",
        url: "https://mcp.supabase.com/mcp?read_only=true",
        headers: { Authorization: "Bearer ${SUPABASE_ACCESS_TOKEN}" },
        env: { SUPABASE_ACCESS_TOKEN: { required: true, description: "Bearer token for the remote endpoint." } },
        note: "Add &project_ref=<ref>&features=database,docs to scope it."
      }
    ],
    docs: "https://github.com/supabase/mcp",
    tags: ["database", "postgres", "backend"],
    defaultTrust: "untrusted"
  },
  {
    id: "firebase",
    name: "Firebase",
    description:
      "Official Firebase MCP bundled in firebase-tools: Firestore, Auth, Functions, Hosting, project management. Reuses an existing `firebase login` session.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firebase-tools", "mcp", "--dir", "."],
    env: {
      FIREBASE_TOKEN: { required: false, description: "Optional CI token; omit to reuse the local `firebase login` session." }
    },
    requires: ["npx"],
    install: "npx firebase-tools login   (or set FIREBASE_TOKEN for CI)",
    docs: "https://github.com/firebase/firebase-tools/tree/main/src/mcp",
    tags: ["firebase", "backend", "hosting"],
    defaultTrust: "untrusted"
  },
  {
    id: "flutter",
    name: "Flutter MCP",
    description:
      "Real-time Flutter/Dart documentation for assistants — looks up current pub.dev APIs instead of guessing, so generated Flutter code is correct.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "flutter-mcp"],
    env: {},
    requires: ["npx"],
    install: "npx flutter-mcp   (npm wrapper installs the Python server on first run)",
    docs: "https://github.com/adamsmaka/flutter-mcp",
    tags: ["flutter", "dart", "documentation"],
    defaultTrust: "untrusted"
  },
  {
    id: "bolt",
    name: "Bolt (CyberStrike security suite)",
    description:
      "Plugin-based security tool server over MCP. Aggregates 25+ pentest/recon MCP servers (nmap, nuclei, sqlmap, ffuf, gobuster, hashcat, impacket, …) behind one endpoint. Not published to npm — run from a clone or the Docker image.",
    transport: "stdio",
    command: "bun",
    args: ["run", "packages/core/src/index.ts"],
    cwdHint: "<path-to-bolt-clone>",
    env: {
      MCP_ADMIN_TOKEN: { required: false, description: "Admin token when running the HTTP transport." }
    },
    requires: ["bun"],
    install: "git clone https://github.com/CyberStrikeus/bolt && bun install   (or: docker run -p 3001:3001 -e MCP_ADMIN_TOKEN=... bolt)",
    variants: [
      {
        id: "bolt-http",
        name: "Bolt (HTTP)",
        transport: "http",
        url: "http://localhost:3001/mcp",
        headers: { Authorization: "Bearer ${MCP_ADMIN_TOKEN}" },
        env: { MCP_ADMIN_TOKEN: { required: false, description: "Admin token (set on the server)." } },
        note: "From the Docker image: docker run -p 3001:3001 -e MCP_ADMIN_TOKEN=... bolt"
      }
    ],
    docs: "https://github.com/CyberStrikeus/bolt",
    tags: ["security", "pentest", "recon", "network"],
    defaultTrust: "untrusted"
  }
];

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

/** Expand ${ENV} placeholders in a string or array from a source map. */
export function expandEnv(value, source = process.env) {
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, source));
  if (typeof value !== "string") return value;
  return value.replace(ENV_PATTERN, (_, name) => (source[name] !== undefined ? String(source[name]) : ""));
}

/** Names of required env vars that are currently unset. */
export function missingEnv(entry, source = process.env) {
  const env = entry.env || {};
  return Object.entries(env)
    .filter(([name, spec]) => spec.required && !source[name])
    .map(([name]) => name);
}

export function listBuiltins({ source = process.env } = {}) {
  return BUILTIN_MCP_SERVERS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    transport: entry.transport,
    docs: entry.docs,
    install: entry.install,
    tags: entry.tags || [],
    requires: entry.requires || [],
    defaultTrust: entry.defaultTrust || "untrusted",
    children: (entry.children || []).map((c) => ({ id: c.id, name: c.name, transport: c.transport })),
    variants: (entry.variants || []).map((v) => ({ id: v.id, name: v.name, transport: v.transport })),
    missingEnv: missingEnv(entry, source),
    ready: missingEnv(entry, source).length === 0
  }));
}

export function getBuiltin(id) {
  const key = String(id || "").toLowerCase();
  for (const entry of BUILTIN_MCP_SERVERS) {
    if (entry.id.toLowerCase() === key) return entry;
    for (const variant of entry.variants || []) {
      if (variant.id.toLowerCase() === key) return { ...variant, parent: entry.id };
    }
    for (const child of entry.children || []) {
      if (child.id.toLowerCase() === key) return { ...child, parent: entry.id };
    }
  }
  return null;
}

/**
 * Turn a built-in (or one of its variants) into a registry server record.
 * @param {string} id built-in id, e.g. "firebase" or a variant id like "bolt-http"
 * @param {{ trust?: "trusted"|"untrusted", enabled?: boolean, name?: string, cwd?: string, env?: Record<string,string> }} [options]
 */
export function resolveBuiltin(id, options = {}) {
  const entry = getBuiltin(id);
  if (!entry) throw new Error(`Unknown built-in MCP server: ${id}`);
  if (entry.transport === "bundle") throw new Error(`${entry.id} is a bundle; install its children instead`);
  const source = { ...process.env, ...(options.env || {}) };

  const record = {
    id: entry.id,
    name: options.name || entry.name,
    transport: entry.transport,
    trust: options.trust === "trusted" ? "trusted" : (entry.defaultTrust || "untrusted"),
    enabled: options.enabled !== false,
    builtin: true,
    docs: entry.docs || null
  };

  if (entry.transport === "http") {
    record.url = entry.url;
    if (entry.headers) {
      const headers = {};
      for (const [key, value] of Object.entries(entry.headers)) {
        const expanded = expandEnv(value, source);
        if (expanded) headers[key] = expanded;
      }
      if (Object.keys(headers).length) record.headers = headers;
    }
  } else {
    record.command = entry.command;
    record.args = expandEnv(entry.args || [], source);
    if (options.cwd || entry.cwdHint) record.cwd = options.cwd || entry.cwdHint;
    const env = {};
    for (const name of Object.keys(entry.env || {})) {
      if (source[name]) env[name] = String(source[name]);
    }
    if (Object.keys(env).length) record.env = env;
  }

  return record;
}
