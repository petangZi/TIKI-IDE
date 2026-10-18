# TIKI Universal IDE — capability matrix

Status key: **done** (implemented + tested), **partial** (works, with named
limits), **na** (not applicable to a local-first build).

| Area | Capability | Status | Notes |
| --- | --- | --- | --- |
| Core | Validated, frozen config | done | Remote bind refuses without opt-in + token. |
| Core | Structured logging | done | Level-gated, JSON lines. |
| Events | Versioned event contract | done | `src/events/schema.mjs`, 40+ types. |
| Events | Monotonic sequence + replay | done | Sequence resumes across restarts. |
| Events | SSE streaming with `Last-Event-ID` | done | Heartbeat + replay honoured. |
| Events | Durable JSONL log + ephemeral deltas | done | Deltas not persisted. |
| Storage | Atomic JSON docs | done | Write-then-rename, 0600. |
| Storage | Run registry | done | Capped at 500. |
| Workspace | Traversal + symlink guards | done | `PATH_ESCAPE`, `SYMLINK_ESCAPE`. |
| Workspace | Read/write/rename/delete/search/stat | done | Binary detection, size caps. |
| Workspace | Optimistic concurrency (`expectHash`) | done | 409 on stale write. |
| Diff | Myers line diff → unified hunks | done | Empty-text handled as zero lines. |
| Diff | Snapshot-based before/after diff | done | Baseline reset endpoint. |
| Security | Command allowlist (no shell) | done | `403` outside the list. |
| Security | Dangerous-pattern rejection | done | `rm -rf`, pipe-to-shell, etc. |
| Security | Approval broker | done | Blocking, expiring, inbox-driven. |
| Security | SSRF guard for tools | done | Private ranges blocked, allowlist required. |
| Security | Secret redaction | done | Applied to logs + tool/MCP output. |
| Security | Loopback-open / remote token+CSRF | done | CSRF header required for mutations. |
| Security | Append-only audit trail | done | `GET /api/audit`. |
| Adapters | Capability conformance check | done | `GET /api/adapters/conform`. |
| Adapters | OpenCode native | partial | Requires a local `opencode` endpoint. |
| Adapters | OpenAI-compatible (Hermes/OpenClaw) | partial | Requires a configured endpoint + key. |
| Adapters | Deterministic offline mock | done | Full event pipeline, no provider. |
| Adapters | Live streaming deltas | done | Mapped to `agent.message.delta`. |
| Engine | Run lifecycle + events | done | queue→start→diff→usage→complete. |
| Engine | Cancellation | done | AbortController per run. |
| Engine | Timeout enforcement | done | 600s default. |
| Engine | Task graph scheduler | done | Dependencies, bounded concurrency, retries. |
| Engine | Task failure blocking | done | Dependents transition to `blocked`. |
| Engine | Sub-agent delegation | done | Depth + enabled enforcement. |
| Cost | Versioned price catalog | done | Reference snapshot rates. |
| Cost | Usage ledger (provider vs user charge) | done | Markup configurable. |
| Prompt | TIKI-owned prompt composition | done | Version fingerprint emitted. |
| Prompt | Custom instructions (capped) | done | 30,000 chars, 0600 override file. |
| MCP | stdio JSON-RPC client | done | initialize / tools / resources / prompts. |
| MCP | Trust gating + output redaction | done | Untrusted servers cannot be invoked. |
| Tools | Schema-validated runtime | done | Input + output validation, timeouts. |
| Tools | Built-in tools | done | `mock.echo`, `weather.current`, `http.get`. |
| API | Dependency-free router | done | `:params`, central body parsing. |
| UI | Dependency-free single-page app | done | No framework, no build step. |
| UI | Explorer + multi-tab editor | done | Gutter, dirty state, save. |
| UI | Unified diff viewer | done | Per-file hunks with line numbers. |
| UI | Live activity timeline (SSE) | done | Filterable by event kind. |
| UI | Command palette + shortcuts | done | `Ctrl/⌘+K`, `+B`, `+S`, `+J`. |
| UI | Resizable panels + theme persistence | done | localStorage theme. |
| UI | Approvals, tools, MCP, usage, prompt, system panels | done | All wired to live endpoints. |
| Quality | Unit tests | done | diff, files, config, prices, events, policy, netguard, schema. |
| Quality | Integration tests | done | engine + full HTTP surface. |
| Quality | Self-check script | done | `npm run check`. |
| Quality | End-to-end smoke (30 checks) | done | `npm run test:smoke`. |

## Known limits

- Adapters other than `mock` need their local endpoints running; detection is a
  bounded health probe, not a guarantee.
- `weather.current` and `http.get` need network egress; `http.get` additionally
  needs its target on `TIKI_TOOL_HTTP_ALLOWLIST`.
- Snapshot contents are cached in memory for the process lifetime (capped per
  snapshot), so a diff taken after a restart has no baseline text for unchanged
  files; those files report as `binary` until re-diffed.
- The scheduler runs in-process with default concurrency 2; there is no
  cross-node distribution.
