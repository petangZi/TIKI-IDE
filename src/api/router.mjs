// src/api/router.mjs
// Tiny dependency-free router. Patterns support :params. JSON body parsing is
// centralised here so route handlers stay small.
import { ApiError, sendError, sendJson } from "./respond.mjs";

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp("^" + pattern.replace(/:[A-Za-z0-9_]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$");
    routes.push({ method, regex, keys, handler, pattern });
  }

  const on = (method) => (pattern, handler) => add(method.toUpperCase(), pattern, handler);
  const get = on("GET");
  const post = on("POST");
  const put = on("PUT");
  const patch = on("PATCH");
  const del = on("DELETE");

  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = pathname.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  async function parseBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
      let body = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { reject(new ApiError("Request body too large", 413, "BODY_TOO_LARGE")); req.destroy(); return; }
        body += chunk;
      });
      req.on("end", () => {
        if (!body) return resolve({});
        try { resolve(JSON.parse(body)); }
        catch { reject(new ApiError("Invalid JSON body", 400, "BAD_JSON")); }
      });
      req.on("error", (error) => reject(error));
    });
  }

  async function handle(req, res, services) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const method = (req.method || "GET").toUpperCase();
    const found = match(method, url.pathname);
    if (!found) return sendJson(res, 404, { error: "Not found", code: "NOT_FOUND" });

    const ctx = {
      req, res, url, method,
      params: found.params,
      query: url.searchParams,
      services,
      readBody: () => parseBody(req, services.config.maxBodyBytes)
    };
    try {
      const result = await found.handler(ctx);
      if (result !== undefined && !res.headersSent) {
        if (result && result.__raw) return; // handler wrote the response itself
        sendJson(res, result?.__status || 200, result?.__status ? result.body : result);
      }
    } catch (error) {
      services.logger.warn?.("route error", { path: url.pathname, method, error: error.message });
      sendError(res, error);
    }
  }

  return { get, post, put, patch, delete: del, handle, routes };
}
