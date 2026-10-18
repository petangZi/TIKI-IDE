# TIKI Universal IDE

Local-first universal AI agent workspace. One shell, multiple execution engines
(OpenCode, Hermes, OpenClaw, plus a deterministic offline mock), observable runs,
verifiable filesystem diffs, server-enforced security, and a dependency-free
premium web UI.

This is the full-stack continuation of `tiki-universal-ide-mvp-v0.3.0`. The MVP
was a single-file scaffold; this tree is the production-shaped system described
by `docs/roadmap.md`.

## Requirements

- Node.js 20 or newer (developed and tested on Node 24).
- No install step. The server has **zero runtime dependencies**.
- Optional: `opencode`, or an OpenAI-compatible `hermes` / `openclaw` endpoint.

## Quick start

```bash
node server.mjs --workspace=/path/to/project
# open http://127.0.0.1:4317
```

Configuration is environment-only (no `.env` auto-load). See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TIKI_HOST` | `127.0.0.1` | Bind address. Non-loopback requires the two options below. |
| `TIKI_PORT` | `4317` | HTTP port. |
| `TIKI_WORKSPACE` | `cwd` | Workspace root the IDE is confined to. |
| `TIKI_DATA_DIR` | `<config>/data` | Runs, events, usage ledger, audit trail. |
| `TIKI_ALLOW_REMOTE` | `0` | Must be `1` to bind beyond loopback. |
| `TIKI_AUTH_TOKEN` | — | Required in remote mode (≥16 chars). |
| `OPENCODE_URL` | `http://127.0.0.1:4096` | OpenCode native endpoint. |
| `HERMES_URL` / `HERMES_API_KEY` | `http://127.0.0.1:8642/v1` | Hermes OpenAI-compatible endpoint. |
| `OPENCLAW_URL` / `OPENCLAW_API_KEY` | `http://127.0.0.1:18789/v1` | OpenClaw endpoint. |
| `TIKI_TOOL_HTTP_ALLOWLIST` | empty (deny all) | Hosts the generic `http.get` tool may reach. |
| `TIKI_PUBLIC_APIS` | `1` | Enables the `public_api.*` tools (curated public-API gateway). |

## Commands

```bash
npm start          # run the server
npm run dev        # run with debug logging
npm run check      # static + runtime self-check (imports, adapters, tools, prompt)
npm test           # unit + integration suites (node:test)
npm run test:unit
npm run test:integration
npm run test:smoke # end-to-end HTTP smoke against a live ephemeral server
npm run build:public-apis # refresh the curated public-apis catalog from upstream
npm run mcp:live   # install and describe the real built-in MCP servers (needs network)
npm run ui:live    # drive the UI in a browser against a running server (needs Playwright)
```

`mcp:live` and `ui:live` are the network-backed counterparts to the offline
suites: the first spawns real MCP servers and reports the tools each one
exposes, the second walks the MCP and Skills panels, toggles trust, and audits
layout. Neither runs in CI. `ui:live` expects Playwright outside this
zero-dependency tree — see the header of `scripts/ui-live.mjs`. A musl host
cannot run Playwright's bundled Chromium, so point `TIKI_CHROMIUM` at the
system browser.

## Architecture

```
server.mjs                  entry: wires config → services → router → http
src/config.mjs              validated, frozen configuration
src/logger.mjs              structured, level-gated logger
src/events/schema.mjs       canonical versioned event contract (one source of truth)
src/events/bus.mjs          sequence assignment, SSE fan-out, replay buffer
src/storage/store.mjs       atomic JSON docs + append-only JSONL event log
src/storage/runs.mjs        run registry
src/workspace/files.mjs     path-safe (traversal/symlink-guarded) filesystem ops
src/workspace/diff.mjs      Myers line diff → unified hunks
src/workspace/snapshot.mjs  hash-index snapshots + verifiable before/after diffs
src/security/redact.mjs     secret redaction for logs + tool output
src/security/audit.mjs      append-only audit trail
src/security/auth.mjs       loopback-open / remote bearer+CSRF gate
src/security/policy.mjs     command allowlist, risk classes, approval broker
src/adapters/               opencode, openai-compatible (hermes/openclaw), mock
src/mcp/client.mjs          dependency-free MCP client (stdio + Streamable HTTP)
src/mcp/builtins.mjs        curated built-in MCP catalog (one-click install)
src/tools/                  non-AI tool runtime (schema validation, timeouts)
src/subagents/registry.mjs  persistent typed sub-agent records
src/engine/orchestrator.mjs run lifecycle: queue → execute → diff → usage → done
src/engine/scheduler.mjs    dependency-aware task graph, retries, cancellation
src/engine/prices.mjs       versioned price catalog
src/engine/cost.mjs         usage ledger (provider cost vs user charge)
src/prompt/manager.mjs      TIKI-owned prompt composition + version fingerprint
src/api/                    dependency-free router + route modules
public/                     dependency-free SPA (index.html, style.css, app.js)
```

### Event contract

Every engine, adapter, tool, and file operation emits onto the versioned schema
in `src/events/schema.mjs`. The bus assigns `sequence` (monotonic, resumed across
restarts) and `event_id`, persists durable events to `events.jsonl`, and streams
all events to the UI over SSE (`/api/events`). The client reconnects with
`Last-Event-ID` and the bus replays anything missed. High-volume deltas
(`agent.message.delta`, `tool.output.delta`, `terminal.output`) are ephemeral and
are not persisted.

### Security model

- The workspace is confined to `TIKI_WORKSPACE`; traversal and symlink escapes
  are rejected server-side (`PATH_ESCAPE`, `SYMLINK_ESCAPE`).
- The command runner executes **only** allowlisted argv (no shell). Anything else
  is `403`. Destructive patterns are blocked even inside allowed commands.
- Approval-required commands emit `tool.approval_required` and block until the
  approval inbox decides (or the request expires).
- Outbound tool requests pass through an SSRF guard: private/loopback/link-local
  destinations are blocked and hosts must be explicitly allowlisted.
- Remote mode is off by default. Enabling it requires an explicit opt-in **and**
  a token, and state-changing requests require a CSRF header the browser cannot
  forge cross-origin.
- MCP servers are treated as untrusted until marked trusted; their output is
  redacted before it reaches the UI.
- MCP supports two transports: **stdio** (child process) and **Streamable HTTP**
  (POST JSON-RPC, JSON or SSE replies). Install from a curated catalog of eleven
  built-ins — REA, Agent Reach (bundle), Supabase, Firebase, Flutter, Bolt,
  Context7, Brave Search, Frontend Inspo, Magic (21st.dev), Lightswind UI —
  via the MCP panel or `POST /api/mcp/builtins/:id/install`. Entries that need a
  token report `needs config` until the env var is set.
- Built-in **skills** (Ponytail, Caveman, OpenSpec) live in the Skills panel:
  the IDE records the choice and surfaces the exact install command to run — it
  never executes the installer itself. See `POST /api/skills/builtins/:id/install`.
- npx-launched MCP servers cold-start slowly (registry resolution + first
  download), so the MCP handshake budget is 90s by default and calls get 30s:
  `TIKI_MCP_INIT_TIMEOUT_MS`, `TIKI_MCP_TIMEOUT_MS`.

### Tool runtime and the public-API gateway

Tools are the AI's non-AI hands: schema-validated, timed out, provenance-tagged,
and audited. Three built-ins ship enabled, plus a curated public-API gateway
generated from [public-apis](https://github.com/public-apis/public-apis):

| Tool | Network | Purpose |
| --- | --- | --- |
| `mock.echo` | no | Deterministic offline echo for pipeline tests. |
| `weather.current` | yes | Open-Meteo forecast/current weather. |
| `http.get` | allowlist | Generic GET confined to `TIKI_TOOL_HTTP_ALLOWLIST`. |
| `public_api.search` | no | Search **2153** curated public APIs across 51 categories. |
| `public_api.describe` | no | Full catalog record (auth/HTTPS/CORS/host) for one id. |
| `public_api.call` | catalog | Call a catalog API over HTTPS, SSRF-guarded. |

`public_api.call` is a gateway, not an open proxy. A request is refused unless
the destination host is declared by the catalog (or the configured allowlist),
must use HTTPS, and still passes the SSRF guard — private/loopback/link-local
addresses are always blocked, responses are size-capped and timed out. The
catalog lives at `src/tools/public-apis/catalog.json` and is regenerated with
`npm run build:public-apis`. Browse it at `GET /api/public-apis` or via the
Tools panel in the UI.

### Prompt ownership

TIKI owns the product prompt. The provider is an execution backend, not the
author of the task framing. `src/prompt/system-prompt.md` is the core; users may
append custom instructions (capped at 30,000 chars, stored at
`<config>/system-prompt.override.md`). Each composed prompt gets a version
fingerprint emitted as `prompt.attached` for traceability.

## UI

The front end in `public/` is a single-page app with no framework and no build
step. A left rail (workspace + file explorer), a main area (agent console,
multi-tab editor with gutter, unified diff viewer, command runner, task board),
and an inspector panel (agent engines, live activity timeline, approvals inbox,
sub-agents, tools, MCP, usage, prompt, system). A command palette (`Ctrl/⌘+K`)
drives navigation and actions; panels are drag-resizable; dark/light theme
persists locally.

## Testing

- `tests/unit` — diff, filesystem guards, config validation, prices, event
  schema, policy, SSRF guard, tool schema.
- `tests/integration` — orchestrator run lifecycle, usage ledger, scheduler
  dependency ordering and failure blocking, sub-agent registry, and the full HTTP
  surface (static shell, file ops, chat+diff, tools, commands, 404s).
- `scripts/smoke.mjs` — boots a real server on an ephemeral port and asserts 30
  end-to-end checks including SSE streaming.

## Documentation

- `docs/roadmap.md` — the capability roadmap this implementation tracks.
- `docs/api.md` — HTTP + SSE reference.
- `docs/capability-matrix.md` — feature status by area.
