# TIKI Universal IDE — HTTP & SSE reference

Base URL: `http://127.0.0.1:4317` (loopback, open) or the configured host/port.
All responses are JSON. Errors use `{ "error": string, "code": string }`.

## System

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, name, version, uptime_ms, workspace }` |
| GET | `/api/version` | `{ name, version, node, schema_version }` |
| GET | `/api/ready` | `{ ready, workspace, adapters }` |
| GET | `/api/runtime` | platform, node, pid, memory, command availability, `agents[]` |
| GET | `/api/capabilities` | `{ policy, auth, adapters, runs, events }` |
| GET | `/api/audit?limit=` | `{ records: [{ id, at, actor, action, target, result, meta }] }` |
| GET | `/api/usage?limit=&run=` | `{ records: [...] }` |
| GET | `/api/usage/summary` | `{ runs, records, provider_cost, user_charge, input_tokens, output_tokens, markup, currency }` |

## Adapters

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/adapters` | `{ adapters: [{ id, name, kind, capabilities }] }` |
| GET | `/api/adapters/conform` | `{ results: [{ ok, id, problems }] }` |
| GET | `/api/adapters/:id/detect` | `{ id, detected, detail }` |

## Workspace

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tree?path=&depth=` | `{ root, path, entries: [{ name, path, type, size }] }` |
| GET | `/api/file?path=` | `{ path, size, binary, hash, content }` (`content` null when binary) |
| POST | `/api/file` | body `{ path, content, expectHash?, create? }` → `{ path, created, hash, size }` |
| POST | `/api/file/rename` | body `{ from, to }` → `{ from, to }` |
| DELETE | `/api/file?path=` | `{ path, removed }` |
| GET | `/api/search?q=&case=&limit=` | `{ query, matches: [{ path, line, text }] }` |
| GET | `/api/stat?path=` | `{ path, type, size, mtime, symlink }` |
| GET | `/api/commands` | `{ commands: [{ id, risk, approval }] }` |
| POST | `/api/command` | body `{ command }` → `{ command, code, output }`; `403` when denied/not approved |
| POST | `/api/snapshot` | `{ id, file_count, created_at }` |
| POST | `/api/diff` | diff against the session baseline; `{ reset: true, ... }` on first call |
| POST | `/api/diff/reset` | `{ snapshot_id, file_count, created_at }` |

Diff report shape: `{ snapshot_id, generated_at, counts: { added, modified, deleted }, additions, deletions, files: [{ path, status, binary, additions, deletions, hunks: [{ header, lines: [{ t, text, aLine, bLine }] }] }], truncated }`.

## Runs & approval

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/chat` | body `{ agent, prompt, model? }` → `{ run, run_id, status, answer, diff, usage, cost }` (waits for completion) |
| POST | `/api/runs` | same body → `202 { run, run_id, status: "queued" }` (fire-and-observe) |
| GET | `/api/runs?limit=&status=` | `{ runs: [...] }` |
| GET | `/api/runs/:id` | `{ run }` |
| POST | `/api/runs/:id/cancel` | `{ cancelled, run_id }` |
| GET | `/api/approvals` | `{ pending: [{ id, kind, summary, detail, run_id, created_at }] }` |
| POST | `/api/approvals/:id/decision` | body `{ approved, reason? }` → `{ ok, id, approved }` |

## Tasks & sub-agents

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tasks` | `{ tasks, stats }` |
| GET | `/api/tasks/stats` | `{ total, running, concurrency, by_status }` |
| POST | `/api/tasks` | body `{ title?, agent, prompt, depends_on?, subagent_id?, max_retries? }` → `201 { task }` |
| POST | `/api/tasks/:id/cancel` | `{ cancelled }` |
| GET | `/api/subagents` | `{ subagents, roles }` |
| POST | `/api/subagents` | body `{ name, role, adapter, model? }` → `201 { subagent, subagents }` |
| PATCH | `/api/subagents/:id` | body `{ enabled?, name?, role?, model? }` → `{ subagent, subagents }` |
| DELETE | `/api/subagents/:id` | `{ subagents }` |

## Tools & MCP

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tools` | `{ tools: [{ id, version, label, category, network, inputSchema, ... }] }` |
| GET | `/api/tools/catalog` | `{ categories, tools }` |
| POST | `/api/tools/:id/invoke` | body `{ args }` → `{ tool, version, duration_ms, ok, data, provenance }` |
| GET | `/api/public-apis?query=&category=&auth=&httpsOnly=&limit=&offset=` | search the curated public-apis catalog |
| GET | `/api/public-apis/stats` | `{ count, categories, https, by_category, by_auth, source, generated_at }` |
| GET | `/api/mcp/servers` | `{ servers }` |
| POST | `/api/mcp/servers` | body `{ name, command, args?, trust? }` → `201 { server, servers }` |
| DELETE | `/api/mcp/servers/:id` | `{ servers }` |
| POST | `/api/mcp/servers/:id/connect` | `{ ok, servers }` |
| POST | `/api/mcp/servers/:id/disconnect` | `{ id, status, servers }` |
| GET | `/api/mcp/servers/:id/describe` | `{ id, serverInfo, capabilities, tools, resources, prompts }` |
| POST | `/api/mcp/servers/:id/call` | body `{ tool, args }` → tool result (redacted) |

### Built-in tool ids

| id | network | notes |
| --- | --- | --- |
| `mock.echo` | no | `{ value }` → `{ echoed }`. Offline. |
| `weather.current` | yes | Open-Meteo. |
| `http.get` | allowlist | Confined to `TIKI_TOOL_HTTP_ALLOWLIST`. |
| `public_api.search` | no | `{ query?, category?, auth?, httpsOnly?, limit?, offset? }` → catalog matches. |
| `public_api.describe` | no | `{ id }` → one catalog record. |
| `public_api.call` | catalog | `{ id?, url?, path?, query?, headers?, maxBytes? }` → HTTPS call; host must be catalog-declared; SSRF-guarded. |

## Prompt & prices

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/system-prompt` | `{ corePrompt, customInstructions, version, customPath, maxCustomCharacters }` |
| PUT | `/api/system-prompt` | body `{ customInstructions }` → updated composition |
| GET | `/api/prices` | `{ entries, markup }` |
| POST | `/api/prices` | body = price entry → `201 { entry }` |
| POST | `/api/prices/markup` | body `{ markup }` → `{ markup }` |

## Server-Sent Events

`GET /api/events` streams `text/event-stream`. Frames are named by event type:

```
id: 42
event: run.started
data: { ...envelope }
```

On connect the bus sends an `event: connected` frame carrying the current
`sequence` and the number of replayed events. Send `Last-Event-ID` (or
`?lastEventId=`) to resume after a disconnect. Keepalive comments are sent every
15 seconds. The full contract lives in `src/events/schema.mjs`.

## Auth

Loopback binds are open. Non-loopback binds require
`Authorization: Bearer <TIKI_AUTH_TOKEN>` (or `tiki_token` cookie / `?token=`),
and all state-changing requests additionally require the `x-tiki-csrf: 1`
header. All UI requests already send it.
