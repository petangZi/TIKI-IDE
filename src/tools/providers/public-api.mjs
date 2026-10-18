// src/tools/providers/public-api.mjs
// Gateway over the curated public-apis catalog (https://github.com/public-apis/public-apis).
//
// Three tools:
//   public_api.search    offline; query the catalog by text/category/auth
//   public_api.describe  offline; full record for one catalog id
//   public_api.call      network; call a catalog host over HTTPS
//
// Outbound calls stay behind the SSRF guard: private/loopback/link-local
// destinations are always blocked, only HTTPS is allowed, responses are size
// capped, and the host must be declared by the catalog (or the configured
// allowlist). The catalog is a curated allowlist of known public APIs, not an
// open proxy.
import { safeFetch, assertSafeUrl, NetworkPolicyError } from "../netguard.mjs";
import { search, getById, catalogHosts, stats, catalogSize, catalogCategories } from "../public-apis/catalog.mjs";

const MAX_BYTES_CAP = 500_000;
const BODY_RETURN_CAP = 200_000;

function buildUrl(args) {
  if (args.url) {
    const url = new URL(args.url);
    if (args.query) for (const [k, v] of Object.entries(args.query)) url.searchParams.set(k, String(v));
    return url;
  }
  if (args.id) {
    const entry = getById(args.id);
    if (!entry) { const e = new Error(`Unknown public API id: ${args.id}`); e.status = 404; e.code = "PUBLIC_API_UNKNOWN"; throw e; }
    const base = new URL(entry.link);
    const target = new URL(base.origin + (args.path || ""));
    if (args.query) for (const [k, v] of Object.entries(args.query)) target.searchParams.set(k, String(v));
    return target;
  }
  const e = new Error("Provide either url or id");
  e.status = 400;
  e.code = "TOOL_INPUT_INVALID";
  throw e;
}

export function createPublicApiProvider({ allowlist = [], enabled = true } = {}) {
  const curatedHosts = catalogHosts();
  const allowedHosts = new Set([...curatedHosts, ...allowlist.map((h) => String(h).toLowerCase())]);
  const allowlistArr = [...allowedHosts];

  const searchTool = {
    id: "public_api.search",
    version: "1.0.0",
    label: "Public API Search",
    category: "public-data",
    description: `Search ${catalogSize} curated public APIs across ${catalogCategories.length} categories by keyword, category, or auth type. Offline.`,
    permissions: { network: [], write: false },
    timeoutMs: 3000,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 120 },
        category: { type: "string", maxLength: 60 },
        auth: { type: "string", maxLength: 20 },
        httpsOnly: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 }
      }
    },
    outputSchema: { type: "object", required: ["count"], properties: { count: { type: "integer" }, total: { type: "integer" }, results: { type: "array" } } },
    async run(args) {
      const result = search({
        query: args.query, category: args.category, auth: args.auth,
        httpsOnly: !!args.httpsOnly, limit: args.limit || 20, offset: args.offset || 0
      });
      return {
        data: {
          ...result,
          results: result.results.map((e) => ({
            id: e.id, name: e.name, description: e.description, category: e.category,
            auth: e.auth, https: e.https, cors: e.cors, host: e.host, link: e.link
          }))
        },
        meta: { source: "public-apis", timestamp: new Date().toISOString(), license: "curated list; each API's own terms apply" }
      };
    }
  };

  const describeTool = {
    id: "public_api.describe",
    version: "1.0.0",
    label: "Public API Describe",
    category: "public-data",
    description: "Return the full catalog record for one public API id, including its HTTPS/CORS/auth posture and host. Offline.",
    permissions: { network: [], write: false },
    timeoutMs: 3000,
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 120 } } },
    outputSchema: { type: "object", required: ["api"] },
    async run(args) {
      const entry = getById(args.id);
      if (!entry) { const e = new Error(`Unknown public API id: ${args.id}`); e.status = 404; e.code = "PUBLIC_API_UNKNOWN"; throw e; }
      return {
        data: { api: entry, host_allowlisted: allowedHosts.has(entry.host) },
        meta: { source: "public-apis", timestamp: new Date().toISOString(), license: "curated list; each API's own terms apply" }
      };
    }
  };

  const callTool = {
    id: "public_api.call",
    version: "1.0.0",
    label: "Public API Call",
    category: "public-data",
    description: "Call a curated public API over HTTPS. Identify it by catalog id (+ optional path/query) or by an absolute url whose host is in the catalog. Private/loopback destinations are blocked.",
    permissions: { network: allowlistArr, write: false },
    timeoutMs: 12_000,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", maxLength: 120 },
        url: { type: "string", maxLength: 2000 },
        path: { type: "string", maxLength: 500 },
        query: { type: "object" },
        headers: { type: "object" },
        maxBytes: { type: "number", maximum: MAX_BYTES_CAP }
      }
    },
    outputSchema: { type: "object", required: ["status"], properties: { status: { type: "integer" }, body: { type: "string" } } },
    async run(args) {
      if (!enabled) { const e = new NetworkPolicyError("Public API calls are disabled (TIKI_PUBLIC_APIS=0)"); throw e; }

      const url = buildUrl(args);
      const host = url.hostname.toLowerCase();

      // Only HTTPS by default; HTTP is permitted solely for explicitly
      // configured allowlist hosts (never for catalog-declared hosts).
      if (url.protocol !== "https:") {
        const inConfigAllowlist = allowlist.map((h) => String(h).toLowerCase()).some((h) => h === host || (h.startsWith("*.") && host.endsWith(h.slice(1))));
        if (!inConfigAllowlist) throw new NetworkPolicyError("Public API calls require HTTPS");
      }

      if (!allowedHosts.has(host)) {
        throw new NetworkPolicyError(`Host not in the public-apis catalog or allowlist: ${host}`);
      }
      // Belt-and-braces: full SSRF guard (private ranges, internal names).
      assertSafeUrl(url.toString(), allowlistArr);

      const entry = getById(args.id) || null;
      const maxBytes = Math.min(Number(args.maxBytes) || MAX_BYTES_CAP, MAX_BYTES_CAP);
      const headers = { accept: "application/json, text/plain;q=0.9, */*;q=0.8", ...(args.headers || {}) };
      const res = await safeFetch(url.toString(), { allowlist: allowlistArr, timeoutMs: 12_000, maxBytes, headers });

      let json = null;
      if ((res.contentType || "").includes("json")) {
        try { json = JSON.parse(res.text); } catch { json = null; }
      }

      return {
        data: {
          status: res.status,
          host,
          url: url.toString(),
          content_type: res.contentType || null,
          bytes: res.text.length,
          body: res.text.slice(0, BODY_RETURN_CAP),
          json
        },
        meta: {
          source: host,
          api_id: entry?.id || null,
          timestamp: new Date().toISOString(),
          license: "check the upstream API's terms of use"
        }
      };
    }
  };

  return [searchTool, describeTool, callTool];
}

export { stats as publicApiStats };
