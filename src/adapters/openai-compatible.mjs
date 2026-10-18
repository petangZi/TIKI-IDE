// src/adapters/openai-compatible.mjs
// Shared implementation for OpenAI-compatible chat endpoints (Hermes, OpenClaw).
import { defineAdapter, normalizeUsage, AdapterError } from "./base.mjs";

async function probe(url, apiKey, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${url}/models`, { headers, signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally { clearTimeout(timer); }
}

export function createOpenAICompatibleAdapter({ id, name, url, apiKey, model }) {
  return defineAdapter({
    id,
    name,
    kind: "openai-compatible",
    capabilities: { streaming: true, tools: true, cancellation: true, usageReporting: true },
    async detect() {
      const r = await probe(url, apiKey);
      return { detected: r.ok, detail: r.ok ? "API online" : (r.error ? `unreachable: ${r.error}` : `HTTP ${r.status}`), url };
    },
    async run({ prompt, systemPrompt, signal, onEvent, modelOverride }) {
      const headers = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      let response;
      try {
        response = await fetch(`${url}/chat/completions`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            model: modelOverride || model,
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt }
            ]
          })
        });
      } catch (error) {
        throw new AdapterError(`${name} request failed: ${error.message}`, { adapterId: id, code: "REQUEST_FAILED" });
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AdapterError(`${name} API HTTP ${response.status}: ${body.slice(0, 300)}`, { adapterId: id, status: response.status, code: "PROVIDER_ERROR" });
      }
      if (!response.body) throw new AdapterError(`${name} returned no stream`, { adapterId: id, code: "NO_STREAM" });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let usage = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            if (evt.includes("tool")) onEvent({ type: "tool.started", text: `Provider tool event: ${evt}` });
            continue;
          }
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") continue;
          let data;
          try { data = JSON.parse(raw); } catch { continue; }
          const choice = data.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta) { text += delta; onEvent({ type: "agent.message.delta", text: delta }); }
          const toolCalls = choice?.delta?.tool_calls;
          if (Array.isArray(toolCalls) && toolCalls.length) {
            for (const call of toolCalls) {
              if (call.function?.name) onEvent({ type: "tool.started", text: `Tool call: ${call.function.name}` });
            }
          }
          if (data.usage) usage = normalizeUsage(data.usage);
        }
      }
      return { text: text || "(provider completed without text output)", usage };
    }
  });
}
