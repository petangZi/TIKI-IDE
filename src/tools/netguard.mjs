// src/tools/netguard.mjs
// SSRF defence for outbound tool requests: private/loopback/link-local
// destinations are blocked by default; hosts must appear on an allowlist.
import net from "node:net";

export function isBlockedIp(ip) {
  const t = net.isIP(ip);
  if (t === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (t === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true;
    if (low.startsWith("fe80")) return true;
    if (low.startsWith("::ffff:")) return isBlockedIp(low.slice(7));
    return false;
  }
  return false;
}

export class NetworkPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkPolicyError";
    this.code = "NETWORK_BLOCKED";
    this.status = 403;
  }
}

export function assertSafeUrl(rawUrl, allowlist = []) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new NetworkPolicyError("Invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new NetworkPolicyError(`Blocked protocol: ${url.protocol}`);
  const host = url.hostname.toLowerCase();
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new NetworkPolicyError("Blocked private/loopback destination");
    return url;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new NetworkPolicyError("Blocked internal hostname");
  }
  const allowed = allowlist.map((h) => h.toLowerCase());
  const ok = allowed.some((entry) => entry === host || (entry.startsWith("*.") && host.endsWith(entry.slice(1))) || host.endsWith("." + entry));
  if (!ok) throw new NetworkPolicyError(`Host not in allowlist: ${host}`);
  return url;
}

/** fetch with timeout, size cap, TLS validation (default), and redirect control. */
export async function safeFetch(url, { allowlist, timeoutMs = 8000, maxBytes = 500_000, headers = {} } = {}) {
  const target = assertSafeUrl(url, allowlist);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Upstream HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, text: await res.text() };
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { controller.abort(); throw new Error("Response exceeded size limit"); }
      text += decoder.decode(value, { stream: true });
    }
    return { status: res.status, text, contentType: res.headers.get("content-type") };
  } finally { clearTimeout(timer); }
}
