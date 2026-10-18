// src/adapters/mock.mjs
// Deterministic offline adapter. Exercises the full event pipeline without a
// provider. Never presented as a real provider in production UI.
import { defineAdapter } from "./base.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMockAdapter({ id = "mock", name = "Mock Agent", delayMs = 25 } = {}) {
  return defineAdapter({
    id,
    name,
    kind: "mock",
    capabilities: { streaming: true, tools: true, terminal: true, cancellation: true, usageReporting: true },
    async detect() {
      return { detected: true, detail: "Offline deterministic adapter (no provider required)", url: null, mock: true };
    },
    async run({ prompt, signal, onEvent }) {
      const echo = prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt;
      const lines = [
        `Acknowledged task: "${echo}".`,
        "Inspecting workspace…",
        "Drafting an incremental plan.",
        "Applying a minimal change.",
        "Verifying the result.",
        "Done."
      ];
      let text = "";
      for (const line of lines) {
        if (signal?.aborted) throw new Error("cancelled");
        await sleep(delayMs);
        text += line + "\n";
        onEvent({ type: "agent.message.delta", text: line + "\n" });
      }
      return { text, usage: { input_tokens: echo.length, output_tokens: text.length, cached_input_tokens: 0 } };
    }
  });
}
