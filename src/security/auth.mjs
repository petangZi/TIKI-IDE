// src/security/auth.mjs
// Authentication for remote (non-loopback) mode. Loopback mode is open by
// design (local-first); anything else requires a bearer token.
import crypto from "node:crypto";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function createAuth({ config }) {
  const enabled = config.remoteAuthEnabled;

  function presentedToken(req) {
    const header = req.headers["authorization"];
    if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams.get("token");
    if (q) return q;
    const cookie = req.headers["cookie"];
    if (typeof cookie === "string") {
      const m = cookie.match(/(?:^|;\s*)tiki_token=([^;]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    return null;
  }

  /** Returns null when authorized, or {status, error} when rejected. */
  function check(req) {
    if (!enabled) return null;
    const token = presentedToken(req);
    if (!token || !safeEqual(token, config.authToken)) {
      return { status: 401, error: "Unauthorized" };
    }
    // CSRF defence: state-changing requests must carry a non-simple header that
    // a cross-origin form/fetch cannot set without CORS approval.
    const method = (req.method || "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      if (req.headers["x-tiki-csrf"] !== "1") return { status: 403, error: "Missing CSRF header" };
    }
    return null;
  }

  function status() {
    return { required: enabled, mode: enabled ? "remote-token" : "loopback-open" };
  }

  return { check, status, enabled };
}
