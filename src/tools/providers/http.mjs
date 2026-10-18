// src/tools/providers/http.mjs
// Generic HTTP GET against an explicit host allowlist. No arbitrary URL proxy:
// destinations must be configured via TIKI_TOOL_HTTP_ALLOWLIST.
import { safeFetch, NetworkPolicyError } from "../netguard.mjs";

export function createHttpProvider({ allowlist = [] } = {}) {
  return {
    id: "http.get",
    version: "1.0.0",
    label: "HTTP GET",
    category: "public-data",
    description: "Fetches a URL from the configured host allowlist and returns its body.",
    permissions: { network: allowlist, write: false },
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", maxLength: 2000 }, maxBytes: { type: "number", maximum: 500_000 } }
    },
    outputSchema: { type: "object", properties: { body: { type: "string" } } },
    async run(args) {
      if (!allowlist.length) throw new NetworkPolicyError("No HTTP hosts configured. Set TIKI_TOOL_HTTP_ALLOWLIST.");
      const res = await safeFetch(args.url, { allowlist, timeoutMs: 10_000, maxBytes: args.maxBytes || 500_000 });
      return {
        data: { status: res.status, content_type: res.contentType || null, body: res.text.slice(0, 200_000) },
        meta: { source: new URL(args.url).hostname, timestamp: new Date().toISOString(), license: "provider terms apply" }
      };
    }
  };
}
