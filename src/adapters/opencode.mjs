// src/adapters/opencode.mjs
// OpenCode native HTTP API adapter. Creates a session, sends the TIKI prompt
// as a system message, and relays native session events when available.
// Native event shape is version-dependent; we degrade to the request response
// text and mark the source rather than fabricating a live tool log.
import { defineAdapter, AdapterError } from "./base.mjs";

export function createOpenCodeAdapter({ url, healthPath = "/global/health", eventPath = "/event" }) {
  const base = url.replace(/\/$/, "");

  async function jsonFetch(path, options = {}, timeoutMs = 2000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, { ...options, signal: options.signal || controller.signal });
      const text = await res.text();
      let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: res.ok, status: res.status, data, text };
    } finally { clearTimeout(timer); }
  }

  return defineAdapter({
    id: "opencode",
    name: "OpenCode",
    kind: "native-api",
    capabilities: { streaming: true, tools: true, fileAccess: true, cancellation: true },
    async detect() {
      try {
        const r = await jsonFetch(healthPath);
        if (!r.ok) return { detected: false, detail: `HTTP ${r.status}`, url: base };
        const version = r.data?.version || r.data?.data?.version;
        return { detected: true, detail: version ? `API online · ${version}` : "API online", url: base, version };
      } catch (error) {
        return { detected: false, detail: `unreachable: ${error.message}`, url: base };
      }
    },
    async run({ prompt, systemPrompt, signal, onEvent, onSession }) {
      const create = await jsonFetch("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: prompt.slice(0, 64) || "TIKI Workspace" }) });
      if (!create.ok) throw new AdapterError(`OpenCode session API HTTP ${create.status}`, { adapterId: "opencode", status: create.status });
      const sessionId = create.data?.id || create.data?.data?.id;
      if (!sessionId) throw new AdapterError("OpenCode did not return a session id", { adapterId: "opencode" });
      onSession?.(sessionId);
      onEvent({ type: "agent.status", text: "Prompt sent; awaiting OpenCode response…" });

      let nativeText = "";
      let streamed = false;
      const stop = await subscribeEvents(base, eventPath, sessionId, signal, (text) => {
        streamed = true;
        nativeText += text;
        onEvent({ type: "agent.message.delta", text });
      });

      try {
        const send = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({ system: systemPrompt, parts: [{ type: "text", text: prompt }] })
        });
        if (!send.ok) {
          const body = await send.text().catch(() => "");
          throw new AdapterError(`OpenCode prompt API HTTP ${send.status}: ${body.slice(0, 300)}`, { adapterId: "opencode", status: send.status });
        }
        const data = await send.json().catch(() => null);
        const responseText = (data?.parts || data?.data?.parts || []).filter((p) => p.type === "text").map((p) => p.text || "").join("\n");
        const text = streamed && nativeText ? nativeText : responseText;
        return { text: text || "(OpenCode completed without text output)", usage: null };
      } finally {
        stop?.();
      }
    }
  });
}

// Best-effort native event subscription. Returns a stop() function. Never throws.
async function subscribeEvents(base, eventPath, sessionId, signal, onText) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  let reader = null;
  try {
    const res = await fetch(`${base}${eventPath}`, { headers: { accept: "text/event-stream" }, signal: controller.signal });
    if (!res.ok || !res.body) { controller.abort(); return null; }
    reader = res.body.getReader();
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const block of parts) {
            const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let evt; try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
            if (evt?.properties?.sessionID && evt.properties.sessionID !== sessionId) continue;
            const part = evt?.properties?.part;
            if (part?.type === "text" && typeof part.text === "string" && evt.type === "message.part.updated") {
              onText(part.text);
            }
          }
        }
      } catch { /* stream closed */ }
    })();
    return () => { try { controller.abort(); } catch {} };
  } catch {
    try { controller.abort(); } catch {}
    return null;
  }
}
