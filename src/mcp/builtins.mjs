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
    note: "Verified running: `bun run packages/core/src/index.ts` from a clone answers initialize as serverInfo bolt 1.0.0 and aggregates ~40 tools (nmap, nuclei, dnsx, alterx, amass, arjun, commix, crtsh, masscan, hydra, medusa, kerbrute, hashcat, john, impacket, …). Two caveats: boot takes minutes, so raise TIKI_MCP_INIT_TIMEOUT_MS (300000 is comfortable), and the working directory must be the clone — set it per server. `bun install --ignore-scripts` skips node-pty, which only degrades the katana child.",
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
  },
  {
    id: "context7",
    name: "Context7",
    description:
      "Up-to-date, version-specific documentation for any library, injected straight into the prompt. Kills hallucinated APIs. Works without a key at lower rate limits.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: {
      CONTEXT7_API_KEY: { required: false, description: "Free key from context7.com/dashboard for higher rate limits (optional)." }
    },
    requires: ["npx"],
    install: "npx ctx7 setup   (OAuth + auto-wire), or install below and add a key later",
    variants: [
      {
        id: "context7-remote",
        name: "Context7 (remote HTTP)",
        transport: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { Authorization: "Bearer ${CONTEXT7_API_KEY}" },
        env: { CONTEXT7_API_KEY: { required: false, description: "Bearer token for the hosted endpoint." } },
        note: "Use this when you prefer a hosted endpoint over a local process."
      }
    ],
    docs: "https://github.com/upstash/context7",
    tags: ["docs", "documentation", "library", "reference"],
    defaultTrust: "untrusted"
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description:
      "Official Brave Search MCP: web, news, image, video and local search, plus LLM-context grounding and AI summarisation. Needs a Brave Search API key.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"],
    env: {
      BRAVE_API_KEY: { required: true, description: "Brave Search API key from api-dashboard.search.brave.com." }
    },
    requires: ["npx"],
    install: "get a free key at https://api-dashboard.search.brave.com, then install below",
    docs: "https://github.com/brave/brave-search-mcp-server",
    tags: ["search", "web", "news", "websearch"],
    defaultTrust: "untrusted"
  },
  {
    id: "frontend-inspo",
    name: "Frontend Inspo",
    description:
      "Local MCP server for frontend inspiration: discovers and pulls real components, UI code and design patterns from shadcn, Magic UI, Aceternity, FreeFrontend and more. No key needed.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "frontend-inspo-mcp"],
    env: {},
    requires: ["npx"],
    install: "npx -y frontend-inspo-mcp   (runs entirely local; scrapes public component galleries)",
    docs: "https://www.npmjs.com/package/frontend-inspo-mcp",
    tags: ["frontend", "ui", "components", "design", "inspiration"],
    defaultTrust: "untrusted"
  },
  {
    id: "magic",
    name: "Magic (21st.dev)",
    description:
      "21st.dev component MCP: search thousands of production UI components and fetch them into your codebase. Also exposes generate/iterate when AI access is enabled. Needs a 21st.dev API key.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@21st-dev/magic@latest"],
    env: {
      API_KEY_21ST: { required: true, description: "Key from https://21st.dev/mcp. Legacy Magic keys no longer work." }
    },
    requires: ["npx"],
    install: "npx @21st-dev/cli@latest init   or grab a key at https://21st.dev/mcp",
    variants: [
      {
        id: "magic-remote",
        name: "Magic (remote HTTP)",
        transport: "http",
        url: "https://21st.dev/api/mcp",
        headers: { "x-api-key": "${API_KEY_21ST}" },
        env: { API_KEY_21ST: { required: true, description: "Key from https://21st.dev/mcp." } },
        note: "Hosted endpoint; the npx package is a thin stdio proxy to the same server."
      }
    ],
    docs: "https://github.com/21st-dev/magic-mcp",
    tags: ["frontend", "ui", "components", "21st"],
    defaultTrust: "untrusted"
  },
  {
    id: "lightswind",
    name: "Lightswind UI",
    description:
      "Component library MCP: browse, fetch and install 160+ animated React/Tailwind components, blocks and page templates directly from an agent. Free tier works without a key; Pro components need a license.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "-p", "lightswind@latest", "-p", "@modelcontextprotocol/sdk", "-p", "fuse.js", "lightswind", "mcp"],
    env: {},
    requires: ["npx"],
    install: "npx lightswind mcp init   (auto-configures Cursor / Claude Desktop)",
    note: "The published CLI (3.2.5) declares only fs-extra, so plain `npx lightswind mcp` dies on MODULE_NOT_FOUND for @modelcontextprotocol/sdk and fuse.js. The launch args pull both alongside it, which starts lightswind-ui-mcp 1.1.0 cleanly.",
    docs: "https://github.com/codewithMUHILAN/Lightswind-UI-Library",
    tags: ["frontend", "ui", "components", "tailwind", "react"],
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
    note: entry.note || null,
    cwdHint: entry.cwdHint || null,
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
    // cwdHint is a placeholder for a path only the user knows (a clone they
    // made), so it is never used as a real cwd — passing "<path-to-...>" to
    // spawn just fails. The caller has to supply the path.
    if (options.cwd) record.cwd = options.cwd;
    const env = {};
    for (const name of Object.keys(entry.env || {})) {
      if (source[name]) env[name] = String(source[name]);
    }
    if (Object.keys(env).length) record.env = env;
  }

  return record;
}
