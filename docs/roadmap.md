# TIKI Universal Web Agent IDE
## Master Roadmap, Execution Plan, Production Architecture & Unit Economics

**Document status:** Strategic working plan  
**Version:** 1.0  
**Last updated:** 2026-10-18  
**Product direction:** Hybrid launcher + bootstrap installer + runtime detection + adapter plugins + portable deployment  
**Primary goal:** A lightweight, polished, local-first web IDE where multiple compatible AI agents can work on real projects with observable live activity, verifiable file diffs, workspace tools, and safe production deployment.

> **Important status rule:** This document is a target roadmap, not a claim that every feature exists today. The current MVP has a Node.js local server, basic workspace/file endpoints, initial agent integration scaffolding, a tools catalog, and basic sub-agent registry CRUD. MCP and SDK adapters are interface scaffolds; non-AI tools are extension points; full agent orchestration, reliable native event streaming, full live diff, production-grade security, and commercial billing are not complete until implemented and tested.

---

# 1. Product vision

TIKI should feel like a premium coding workspace rather than a chat window wrapped around a code editor. A user can choose an agent/runtime, assign a task, watch actual activity, inspect changed files, approve sensitive operations, run tests, preview the app, and review the final result.

## Product principles

1. **Truthful real-time UX:** show only events, progress, costs, and status supported by actual backend data. Never fabricate percentages or fake terminal activity.
2. **Provider independence:** core orchestration must not be coupled to a single model vendor or agent runtime.
3. **Local-first by default:** bind to loopback, keep workspaces local unless explicitly configured otherwise, and avoid surprise uploads.
4. **Safe autonomy:** agent capabilities are bounded by policy, workspace boundaries, approvals, timeouts, and resource limits.
5. **Lightweight core:** use mature dependencies where they provide clear value; avoid needless abstraction and heavy services in the first release.
6. **Incremental delivery:** every milestone ends in a runnable, testable artifact.
7. **Honest capability reporting:** distinguish `implemented`, `partial`, `scaffold`, `mock`, and `planned`.
8. **Production economics:** provider cost, infrastructure, support, payment fees, taxes, and abuse risk must be measured before pricing is finalized.

## Target users

- Individual developers and AI coding enthusiasts.
- Small teams that want a unified interface for local agent runtimes.
- Advanced users working in Termux, Linux, macOS, Windows, containers, or a VPS where supported.
- Teams that need auditability and workspace-level controls without committing to one AI vendor.

## Non-goals for the first production release

- Training or hosting frontier models ourselves.
- Guaranteeing compatibility with every agent/model/tool.
- Running arbitrary user code on a shared server without isolation.
- Offering unlimited AI usage at a fixed low price before usage distributions are understood.
- Claiming full autonomous software delivery without human review.

---

# 2. Current baseline and capability labels

Before adding features, audit the repository and label each capability:

- **Implemented:** present and verified with repeatable tests.
- **Partial:** works for a limited path, provider, or environment.
- **Scaffold:** contracts, placeholder endpoints, or structure exist, but no complete integration.
- **Mock/demo:** illustrative UI or fake data used for design/testing.
- **Planned:** not implemented.

Current MVP baseline from the project handoff:

| Area | Baseline status | Production gap |
|---|---|---|
| Local Node.js server and launcher | Partial / MVP | startup hardening, config validation, lifecycle management |
| Workspace tree/file APIs | Basic MVP | path boundary enforcement, conflict detection, larger files, robust tests |
| Agent integrations | Initial connector/scaffolding | native runtime event support, lifecycle, cancellation, reconnection |
| MCP adapter | Scaffold | complete protocol client, discovery, transport handling, permissions |
| SDK adapter | Contract/scaffold | real adapter SDK, examples, compatibility tests |
| Non-AI `TOOLS/` | Catalog/contracts | real providers, schemas, rate limits, secrets, SSRF protection |
| Sub-agent registry CRUD | Basic MVP | real scheduler/orchestration, isolation, delegation, cancellation |
| Live activity feed | Partial UI direction | event-sourced backend and native provider events |
| Live diff | Planned/partial | reliable filesystem diff, snapshots, review/restore workflow |
| Security | Basic local-first intent | sandbox, policies, audit, auth for remote use, threat testing |
| Billing / token metering | Not implemented | accurate usage events, ledger, provider reconciliation, quotas |
| Production deployment | Planned | supported-platform matrix, packaging, updates, incident response |

Do not mark a row production-ready until tests and documented acceptance criteria pass.

---

# 3. Target architecture

```text
tiki-universal-ide/
├── apps/
│   ├── web/                      # IDE interface
│   └── desktop/                  # optional desktop wrapper later
├── server/
│   ├── api/                      # HTTP API and validation
│   ├── events/                   # SSE/WebSocket, replay, event IDs
│   ├── workspace/                # filesystem, snapshots, diffs
│   ├── terminal/                 # managed terminal/process sessions
│   ├── preview/                  # local dev server and port discovery
│   ├── security/                 # policy, approval, auth, audit
│   ├── storage/                  # runs, settings, history, usage ledger
│   └── billing/                  # quotas, pricing, metering, reconciliation
├── engine/
│   ├── orchestrator/             # agent run lifecycle
│   ├── scheduler/                # queue, dependencies, concurrency
│   ├── event-schema/             # canonical event contracts
│   ├── recovery/                 # retries, resume, idempotency
│   └── cost-engine/              # provider cost and user charge calculation
├── adapters/
│   ├── opencode/
│   ├── hermes/
│   ├── openclaw/
│   ├── mcp/
│   └── sdk/
├── tools/
│   ├── weather/
│   ├── market-data/
│   ├── public-data/
│   ├── http/
│   └── scraping/
├── subagents/
│   ├── registry/
│   ├── planner/
│   ├── workers/
│   └── reviewer/
├── packages/
│   ├── ui/
│   ├── contracts/
│   ├── adapter-sdk/
│   ├── tool-sdk/
│   └── test-fixtures/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── performance/
├── docs/
├── scripts/
└── roadmap.md
```

This is the target structure, not a requirement to create all folders at once. Keep the current MVP runnable while migrating incrementally. Avoid splitting into many packages until boundaries and tests justify it.

## Main service boundaries

- **Web UI:** presentation, user interaction, optimistic UI only where reversible.
- **API server:** authentication, input validation, workspace authorization, rate limits.
- **Agent adapter:** translates provider/runtime-specific lifecycle and events into TIKI contracts.
- **Orchestrator:** owns run lifecycle, queue, retries, cancellation, sub-agent dependency graph.
- **Event service:** durable event IDs, streaming, replay, reconnection.
- **Workspace service:** path-safe file operations, snapshots, diff calculation, restore.
- **Tool runtime:** validates and executes approved non-AI/MCP tools with resource limits.
- **Usage ledger:** stores raw provider usage and calculated cost/charge records separately.
- **Policy engine:** makes permission decisions server-side; UI confirmation alone is not a security boundary.

---

# 4. Universal event contract

Every adapter should emit canonical events. Suggested envelope:

```json
{
  "schema_version": "1",
  "event_id": "unique-id",
  "run_id": "run-id",
  "parent_run_id": null,
  "agent_id": "agent-id",
  "adapter_id": "adapter-id",
  "timestamp": "ISO-8601",
  "sequence": 42,
  "type": "tool.started",
  "visibility": "user",
  "payload": {}
}
```

Suggested event types:

- `run.queued`, `run.started`, `run.waiting_approval`, `run.completed`, `run.failed`, `run.cancelled`
- `agent.status`, `agent.message.delta`, `agent.message.completed`
- `plan.created`, `task.created`, `task.started`, `task.completed`, `task.blocked`
- `tool.requested`, `tool.approval_required`, `tool.started`, `tool.output.delta`, `tool.completed`, `tool.failed`
- `file.read`, `file.created`, `file.changed`, `file.deleted`, `diff.updated`
- `terminal.started`, `terminal.output`, `terminal.exit`
- `test.started`, `test.result`, `build.started`, `build.result`
- `usage.reported`, `cost.updated`
- `connection.lost`, `connection.restored`, `warning.created`

Requirements:
- Validate events against a versioned schema.
- Assign stable run and event IDs.
- Store events before/alongside publishing when durability is required.
- Reconnect using the last event ID and replay missed events.
- Redact secrets before persistence and display.
- Do not expose internal chain-of-thought or hidden reasoning. Show concise task summaries, tool calls, observable actions, results, and evidence instead.
- If a provider does not support a native event, label the activity as inferred or unavailable rather than pretending it is native.

---

# 5. Master roadmap

Priority definitions:
- **P0:** required before dependable daily use.
- **P1:** needed for a strong public beta.
- **P2:** valuable production expansion.
- **P3:** later differentiator.

## Phase 0 — Audit and stabilize the MVP (P0)

1. Inventory all routes, modules, dependencies, launch scripts, and UI states.
2. Mark features implemented/partial/scaffold/mock/planned.
3. Add central configuration validation and safe defaults.
4. Standardize error responses and logging.
5. Add health, readiness, and version endpoints.
6. Ensure clean startup/shutdown and child-process cleanup.
7. Add unit and smoke tests for existing routes.
8. Add repository linting/formatting and CI checks.
9. Record baseline memory, CPU, startup time, and bundle size.
10. Document supported Node versions and operating systems.
11. Make the app run from a clean checkout using documented steps.
12. Ensure temporary test data is removed after tests.

**Acceptance gate:** clean install → launch → health check → workspace read → stop → relaunch succeeds repeatedly without leaked processes or corrupted state.

## Phase 1 — Premium UI/UX foundation (P0)

1. Define TIKI visual language: restrained graphite/dark base, one controlled accent, clear typography.
2. Create design tokens for color, spacing, type, borders, radii, shadows, and motion.
3. Build consistent button, input, menu, tooltip, dialog, tabs, badge, and notification components.
4. Add resizable panels: explorer, editor, terminal, activity, agent chat.
5. Add command palette and keyboard shortcuts.
6. Add quick switcher for files, projects, agents, and runs.
7. Add project switcher, recent workspaces, pinned files, breadcrumbs.
8. Add tab persistence and unsaved-file indicators.
9. Add empty, loading, error, offline, and permission-denied states.
10. Add dark/light themes and reduced-motion preference.
11. Add mobile/tablet layouts without compromising desktop workflows.
12. Add keyboard navigation and visible focus.
13. Add accessible labels, contrast checks, and screen-reader semantics.
14. Add layout presets and panel visibility settings.
15. Keep animations short, purposeful, and low-resource.
16. Avoid decorative charts or fake activity that obscure actual work.

**Acceptance gate:** core workflows are usable by keyboard, at narrow viewport widths, and with reduced motion; no critical controls are hidden behind hover-only interactions.

## Phase 2 — Real-time agent engine (P0)

1. Define canonical event schema and schema versioning.
2. Implement SSE first for straightforward server-to-browser event streaming; use WebSocket only where bidirectional low-latency interaction requires it.
3. Connect a real supported adapter and stream real provider/runtime events.
4. Persist run metadata and important events.
5. Add stable event IDs and sequence numbers.
6. Add reconnect, heartbeat, replay, and stale-connection indicators.
7. Show queued/running/waiting approval/completed/failed/cancelled.
8. Stream agent text/output when supported by provider.
9. Show tool call start, input summary, output, exit status, and duration.
10. Implement real cancellation and confirm the process/run actually stops.
11. Implement timeout, bounded retries, and idempotency rules.
12. Distinguish native events from inferred events.
13. Add output truncation and backpressure.
14. Add log filters by run, agent, tool, severity, and time.
15. Add redaction before storing or displaying secrets.
16. Add error details with safe diagnostics and remediation hints.
17. Restore run state after page refresh.
18. Support resumable observation even if the original browser tab closes.
19. Add tests for dropped connections, duplicate events, out-of-order events, and reconnect replay.
20. Show progress from actual task/test milestones; never invent arbitrary percentages.

**Acceptance gate:** a real agent run can be started, observed live, interrupted, reconnected to, and audited without fake events or lost final status.

## Phase 3 — Workspace, editor, and verifiable live diff (P0)

1. Add a mature editor component only after evaluating bundle/runtime costs.
2. Add syntax highlighting, diagnostics, formatting, and language support incrementally.
3. Add file tree operations with server-side path validation.
4. Track workspace root and deny traversal outside approved roots.
5. Add snapshots before agent modifications.
6. Calculate diffs from actual filesystem snapshots or version-control data.
7. Show added/modified/deleted files and line-level changes.
8. Connect `file.changed` and `diff.updated` events to the UI.
9. Detect concurrent manual edits and conflicts.
10. Never silently overwrite a user's changes.
11. Add accept/reject per file or hunk where feasible.
12. Add restore/undo from snapshots.
13. Integrate Git status, branches, diff, staging, and commits.
14. Add search in files and workspace-wide symbol/text search.
15. Add Markdown, JSON, HTML, and config previews.
16. Add large-file safeguards and diff limits.
17. Add tests for renames, deletions, binary files, symlinks, and concurrent edits.

**Acceptance gate:** a run's reported file changes match the actual workspace diff, and users can review or restore changes.

## Phase 4 — Adapter SDK and runtime detection (P0/P1)

1. Define adapter lifecycle: discover, validate, connect, health-check, run, cancel, disconnect.
2. Define capability manifest: streaming, tools, terminal, file access, cancellation, usage reporting, resume.
3. Define adapter configuration schema and validation.
4. Add adapter version and compatibility negotiation.
5. Add runtime detection that does not execute unsafe commands.
6. Add OpenCode integration based on its supported API/CLI behavior.
7. Add Hermes integration only after confirming the actual interface and supported events.
8. Add OpenClaw integration only after confirming its actual interface and supported events.
9. Add timeout, reconnection, graceful shutdown, and useful error states.
10. Add adapter conformance test suite.
11. Provide a minimal example adapter and developer docs.
12. Add adapter diagnostics page and redacted connection logs.
13. Add provider selection and capability-aware UI.
14. Do not imply an unsupported capability is available.

**Acceptance gate:** a new adapter can be added without changing the orchestration core and passes the same contract tests.

## Phase 5 — MCP integration (P1)

1. Implement a real MCP client against the chosen supported protocol/version.
2. Support stdio and the appropriate current HTTP transport; document transport compatibility.
3. Discover server capabilities and available tools/resources/prompts.
4. Validate tool arguments and results using schemas.
5. Add server registry and enable/disable controls.
6. Add per-server and per-tool permissions.
7. Require approval for sensitive actions.
8. Add connection timeout, cancellation, output limits, and rate limiting.
9. Treat MCP server descriptions and outputs as untrusted data.
10. Redact secrets from logs.
11. Add server health indicators and reconnect policy.
12. Test malformed messages, server crashes, huge outputs, and unauthorized operations.
13. Document trusted/untrusted server setup.

**Acceptance gate:** MCP tools can be discovered, permissioned, invoked, observed, and audited with real protocol traffic.

## Phase 6 — `TOOLS/` non-AI integrations (P1)

1. Standardize tool contract: ID, version, schema, permissions, timeout, output schema.
2. Build registry and connector lifecycle.
3. Add HTTP client with TLS validation, timeout, retry, pagination, and rate limits.
4. Add weather provider through a documented API.
5. Add financial/market data provider with source, timestamp, license, and delay labels.
6. Add public-data connectors for selected reputable sources.
7. Add RSS/JSON/CSV/XML parsing.
8. Add permitted public-page extraction; respect site terms, robots rules where applicable, and rate limits.
9. Block unsafe local/private network destinations by default to reduce SSRF risk.
10. Add URL allowlists or per-tool network policies.
11. Add caching, deduplication, and stale-data indicators.
12. Add mock providers for offline testing.
13. Add connector test console and response inspector.
14. Add per-provider quotas and error budgets.
15. Keep tools usable independently of any AI model.

**Acceptance gate:** each shipped connector has real data, documented provenance, schema validation, rate limits, permission policy, and repeatable tests.

## Phase 7 — Sub-agent orchestration (P1/P2)

1. Evolve sub-agent registry into persistent typed records.
2. Define roles, capabilities, adapter, model, limits, and workspace permissions.
3. Build task graph with explicit dependencies.
4. Add queue, concurrency limit, timeout, cancellation, and retry.
5. Add planner and structured handoff payloads.
6. Add task board with parent/child relationships.
7. Add workspace/branch isolation for parallel file-writing agents.
8. Add merge/conflict review before combining changes.
9. Add optional independent reviewer and test agent.
10. Add agent budget caps and max delegation depth.
11. Prevent recursive delegation loops.
12. Add deterministic task IDs and recovery after server restart.
13. Support dynamic agent add/remove/disable with safe lifecycle handling.
14. Prefer one agent for small tasks; parallelize only independent tasks.
15. Do not expose hidden chain-of-thought; show concise plans, actions, results, and evidence.

**Acceptance gate:** two or more agents can work on independent tasks, with visible status, controlled workspace access, and safe merge/review.

## Phase 8 — Full-stack workspace (P1/P2)

1. Managed terminal sessions with explicit process lifecycle.
2. Process manager for dev servers, workers, and test runners.
3. Port discovery and local preview.
4. Framework/runtime detection and workspace templates.
5. Unit/integration/e2e test runner integration.
6. Lint, type-check, formatter, and build diagnostics.
7. Package manager detection for supported ecosystems.
8. Environment-variable UI with secret redaction.
9. Git workflow and conflict visibility.
10. API request tester and saved collections.
11. Optional database browser with explicit credential boundaries.
12. Migration preview and approval before schema-changing actions.
13. Docker/container integration where available.
14. Build artifact explorer.
15. Deployment integrations only after secure credential handling and approval workflows exist.

**Acceptance gate:** a user can open a project, start its dev server, see logs, preview it, run tests, inspect changes, and stop all managed processes from TIKI.

## Phase 9 — Observability and user experience (P1/P2)

1. Activity timeline with real timestamps.
2. Per-agent activity feed and task board.
3. File diff links from activity events.
4. Terminal output search and ANSI support.
5. Run history and compare-run view.
6. Usage/cost view only when backed by actual usage records.
7. Test/build result panels.
8. Error navigation to the relevant file/line when known.
9. Approval inbox.
10. Keyboard-first workflows and contextual actions.
11. Large-log virtualization and bounded memory.
12. Notification settings and non-disruptive toasts.
13. Exportable diagnostic bundles with secret redaction.
14. Performance and accessibility budgets.
15. Optional telemetry must be opt-in, transparent, and privacy-conscious.

## Phase 10 — Security and trust (P0 for remote access; P1 for local production)

1. Bind to loopback by default.
2. Require authentication for remote access.
3. Use secure session management and CSRF protections where applicable.
4. Keep workspace roots explicit and enforce filesystem boundaries server-side.
5. Use a policy engine; UI confirmations are not security boundaries.
6. Add command risk classifications and configurable approval.
7. Restrict child-process environment and inherited secrets.
8. Add sandbox/container execution where available.
9. Apply CPU, memory, process, network, disk, and time limits.
10. Prevent path traversal and unsafe symlink escapes.
11. Protect connectors from SSRF and unsafe redirects.
12. Use secret storage or OS-supported credential facilities where feasible.
13. Redact secrets in logs, errors, telemetry, and exports.
14. Add audit records for user/agent/tool actions.
15. Treat repository content, tool output, webpages, and MCP descriptions as untrusted inputs.
16. Use least privilege for adapters and tools.
17. Add dependency scanning, SBOM, and license checks.
18. Add backup and rollback for destructive actions.
19. Threat-model remote server mode separately from local mode.
20. Run security tests before public releases.

**Acceptance gate:** security-critical tests pass; remote mode cannot be enabled accidentally; dangerous operations are governed by server-side policies.

## Phase 11 — Portable deployment and release engineering (P1)

1. Bootstrap installer checks supported runtime and dependencies.
2. Launcher reports exact local URL and startup errors.
3. Runtime detection is bounded, predictable, and documented.
4. Separate project files, user config, cache, logs, and secrets.
5. Add portable mode without writing outside the chosen directories unexpectedly.
6. Test supported Linux/macOS/Windows environments.
7. Test Android/Termux and proot as separate compatibility targets; do not assume full parity.
8. Test VPS/server mode with authentication and explicit network configuration.
9. Add versioned migrations and rollback.
10. Add update verification and release checksums/signatures where feasible.
11. Add offline mode for local features.
12. Add backup/export/import.
13. Add process cleanup and uninstall behavior.
14. Publish a support matrix and known limitations.
15. Create reproducible release artifacts and an SBOM.

## Phase 12 — Billing, token metering, and commercial production (P0 before charging users)

1. Separate provider cost, user charge, taxes, and payment fees in the data model.
2. Store provider, model, request ID, input tokens, output tokens, cached tokens, reasoning tokens if billed separately, and tool charges where available.
3. Preserve raw provider usage and a versioned price snapshot for every request.
4. Reconcile TIKI estimates against provider invoices/usage dashboards.
5. Define rounding and currency conversion policy.
6. Add hard user budgets, per-run limits, rate limits, and abuse protection.
7. Show estimated cost before expensive tasks when possible.
8. Show actual cost after usage is reported; mark estimates as estimates.
9. Add usage history, receipts, quota alerts, and refunds/adjustments workflow.
10. Add payment provider integration only after legal, tax, and account requirements are reviewed.
11. Add admin reconciliation and anomaly detection.
12. Define data retention, privacy policy, terms, refund policy, and support process.
13. Test failed requests, retries, duplicate callbacks, partial usage, and provider price changes.
14. Do not promise “unlimited” until worst-case usage and abuse controls are understood.

## Phase 13 — Production quality and release gates (P1)

1. Unit, integration, adapter contract, end-to-end, security, and regression suites.
2. CI on supported runtime/platform matrix.
3. Load tests for event streaming and concurrent runs.
4. Memory-leak and long-session tests.
5. Accessibility checks and keyboard-only review.
6. Crash recovery and restart tests.
7. Structured logs and health metrics.
8. Incident playbook and support diagnostics.
9. Versioned docs, migration notes, changelog, and release checklist.
10. Beta feedback process and opt-in crash reporting.
11. Rollback procedure for app and schema releases.
12. Release candidate sign-off by acceptance gates, not calendar date alone.

---

# 6. Execution plan: first 10 sprints

The durations below are planning estimates for a small team or solo developer working part-time/full-time at different rates. They are not delivery promises. Re-estimate after the first audit.

| Sprint | Focus | Deliverables | Exit criteria |
|---|---|---|---|
| A | Audit & tests | Capability matrix, architecture notes, baseline tests | Clean install and repeatable smoke tests |
| B | Event contract | Versioned schema, run IDs, event storage | Validated events persist and can be replayed |
| C | One real adapter | Start/run/cancel/status lifecycle | Real events visible; errors handled |
| D | Live activity UI | Timeline, reconnect, run history | Refresh/reconnect does not lose final status |
| E | Filesystem diff | Snapshot/diff/review/restore | UI diff matches actual workspace |
| F | Workspace UX | Editor, terminal, preview, process cleanup | End-to-end edit → run → test → review works |
| G | Adapter SDK | Example adapter, capability manifest, contract tests | New adapter added without core rewrite |
| H | Tools + MCP | Real first connector, policy, schema validation | Tool is real, permissioned, observable, tested |
| I | Sub-agents | Queue, task graph, isolated work, review | Parallel tasks complete without silent conflicts |
| J | Security + release | Threat tests, portable install, docs, billing design | Release gates pass for named supported platforms |

**Sprint discipline**
- Start each sprint with a small, testable objective.
- Keep changes incremental and preserve a runnable main branch.
- Do not add multiple providers before the first adapter is stable.
- Use feature flags for incomplete integrations.
- Every sprint ends with tests, updated docs, and an explicit list of known gaps.

---

# 7. Production operating modes

## Mode A — Local-first / BYOK (recommended first commercial model)

Users run TIKI locally and supply their own provider credentials. TIKI charges for the IDE, premium features, team controls, or support rather than reselling every model token.

Advantages:
- Lower working-capital and abuse exposure.
- Users pay their own model provider.
- Easier to offer a predictable subscription.
- Good fit for power users and local agent runtimes.

Risks:
- Setup friction and provider-key safety.
- Provider compatibility varies.
- Users may expect support for every external runtime.

## Mode B — Managed token gateway

TIKI owns the provider account and bills users for token consumption through a managed gateway.

Advantages:
- Simplified onboarding and unified usage display.
- TIKI can offer a single balance and supported provider list.

Risks:
- TIKI pays provider invoices before/while collecting user payments.
- Margin is exposed to price changes, retries, long contexts, and abuse.
- Requires quotas, anti-abuse, provider reconciliation, payment handling, customer support, privacy/legal review, and clear pricing.
- Never launch with an unlimited plan without strong usage limits.

## Mode C — Hybrid

Offer BYOK as the default and optional managed credits for supported models. Keep separate ledgers, clear price labels, and separate limits. This is the recommended long-term direction.

---

# 8. Token cost model

## 8.1 Token pricing formula

For each provider/model, use the current official price table and store a versioned snapshot.

For a model with prices expressed per one million tokens:

```text
provider_cost =
    (input_tokens / 1,000,000) * input_price_per_million
  + (output_tokens / 1,000,000) * output_price_per_million
  + (cached_input_tokens / 1,000,000) * cached_input_price_per_million
  + separately_billed_reasoning_or_tool_costs
```

If the provider reports cached tokens as a subset of input tokens, do not charge those tokens twice. Use the provider's documented accounting semantics. Add image, audio, video, search, and tool fees as separate line items when applicable.

Example only, **not a claim about any live provider price**:
- Input: 100,000 tokens
- Output: 20,000 tokens
- Input price: $2.00 / million
- Output price: $8.00 / million

```text
Input  = 100,000 / 1,000,000 * $2.00 = $0.20
Output =  20,000 / 1,000,000 * $8.00 = $0.16
Total provider cost = $0.36
```

## 8.2 Cost per 1,000 tokens

```text
input_cost_per_1k  = input_price_per_million / 1000
output_cost_per_1k = output_price_per_million / 1000
```

Keep input, output, cached input, and any separately billed modalities distinct. A single “cost per token” number is misleading because input and output prices can differ substantially.



## 8.6 Illustrative official API price snapshot (verify before launch)

Checked against official pricing pages on **2026-10-18**. These are reference snapshots, not a promise that the provider will keep these rates. Prices may vary by model, context window, region, batch/priority mode, cache behavior, and account terms. Recheck the official pages before configuring the billing engine.

| Provider/model example | Input / 1M tokens | Output / 1M tokens | Notes |
|---|---:|---:|---|
| OpenAI `gpt-6.1-sol` standard example | $1.00 | $5.00 | Official page also lists different rates for long context and processing modes. |
| Anthropic Claude Sonnet 5.5 | $2.00 | $10.00 | Prompt-cache writes and cache hits have separate rates. |
| Anthropic Claude Haiku 5.5 | $0.10* | $0.50 | Input rate shown for prompts up to 100k tokens; verify applicable context tier. |
| DeepSeek API current model table | $0.15 off-peak / $0.30 peak for cache-miss input | $0.66 off-peak / $1.32 peak | Official table distinguishes cache hits, cache misses, and time-of-day rates. |
| Google Gemini API | Model-specific | Model-specific | Pricing varies by model and mode; use the exact model's row in the official table, not a generic family rate. |

Official source pages:
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- Anthropic Claude API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Google Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- DeepSeek API pricing: https://api-docs.deepseek.com/quick_start/pricing/

*The table is a small set of examples, not a full model catalog. Never hardcode these example rates as permanent truths. The production price catalog should store `provider`, exact `model_id`, context tier, input/output/cached-input rates, currency, effective date, source URL, and `price_version`. Add an admin update path and automated alerts for rate changes where feasible.*

## 8.7 Example customer-facing managed rates

A simple starting rule is to test **1.6×–1.8× the verified provider cost** for managed tokens, then confirm the realized margin after variable infrastructure, payment fees, refunds, and support. This is a starting hypothesis, not a universal rule. For very cheap models, consider a minimum charge per request or a credit unit because payment fees and support can exceed the raw token cost.

Illustration only, using the snapshot examples above and **1.7× provider rate**, before tax and excluding separate tool/API charges:

| Model example | Input sell rate / 1M | Output sell rate / 1M | Input / 1K | Output / 1K |
|---|---:|---:|---:|---:|
| OpenAI `gpt-6.1-sol` | $1.70 | $8.50 | $0.00170 | $0.00850 |
| Claude Sonnet 5.5 | $3.40 | $17.00 | $0.00340 | $0.01700 |
| Claude Haiku 5.5* | $0.17 | $0.85 | $0.00017 | $0.00085 |
| DeepSeek cache-miss input / output, off-peak | $0.255 | $1.122 | $0.000255 | $0.001122 |
| DeepSeek cache-miss input / output, peak | $0.51 | $2.244 | $0.00051 | $0.002244 |

This table only demonstrates the calculation. Do not publish a rate card from it without rechecking the exact model IDs, context tiers, token accounting, and provider terms. A single model's input/output prices must be configured independently; cached input and other modalities need their own lines. For Indonesia, display a clear IDR equivalent using a documented exchange-rate source and timestamp, and define when exchange rates are refreshed.

## 8.3 Per-run cost

```text
provider_cost_per_run =
    model_cost
  + tool/API charges
  + any separately billed search/image/audio charges
  + attributable infrastructure cost
```

Provider cost should be separated from internal infrastructure cost so that pricing can be audited.

## 8.4 Unit economics

```text
net_revenue = customer_payment_ex_tax - payment_fees - refunds
gross_profit = net_revenue - provider_cost - variable_infrastructure_cost
gross_margin = gross_profit / net_revenue
```

Also account for fixed costs separately: development, support, legal/accounting, monitoring, storage, marketing, and payment-provider minimums. Taxes depend on the selling entity and customer location; consult a qualified local professional before launch.

## 8.5 Usage-ledger fields

Store at least:
- `user_id`, `workspace_id`, `run_id`, `request_id`
- `provider`, `model`, `price_version`, `currency`
- `input_tokens`, `output_tokens`, `cached_input_tokens`
- `reasoning_tokens` or other categories only where provider-reported and relevant
- `provider_cost`, `tool_cost`, `infrastructure_allocation`
- `estimated_user_charge`, `final_user_charge`, `status`
- `created_at`, `reconciled_at`
- `source` (provider usage response, invoice reconciliation, or estimate)

Never store API keys in usage records or logs.

---

# 9. Pricing strategy and recommended starting offers

**Do not finalize managed token prices until live provider rates have been verified from official pricing pages and tested against real usage.** Provider prices change, model categories differ, and cached input/tool/image costs can change the result. The example prices below are strategic starting hypotheses in IDR, not market research or guaranteed profitable rates.

## Recommended launch strategy

Start with **BYOK subscription + optional prepaid managed credits**. This prevents the core subscription from silently absorbing unlimited provider usage.

### Suggested plan hypotheses

| Plan | Indicative price | Included value | Guardrails |
|---|---:|---|---|
| Free / Local | Rp0 | Local IDE, limited runs/features, BYOK where feasible | No bundled paid tokens; modest local limits |
| Solo | Rp29k–49k/month | Premium UI, workspace profiles, run history, basic adapters | BYOK; no unlimited managed inference |
| Pro | Rp79k–129k/month | Advanced workflow, more projects, sub-agent controls, better observability | BYOK or separate credits; fair-use policy |
| Team | Rp199k–399k/month for a small team | Shared settings, roles, audit, team workspaces | Per-seat/usage caps; team controls |
| Managed credits | Prepaid, usage-based | Provider calls through TIKI | Charge based on actual model-specific cost and margin policy |

These prices should be validated with user interviews and actual support/hosting costs. They are not a recommendation to promise every feature in these plans before it exists.

## Managed token markup formula

For a managed model, let:
- `C` = provider cost for a request
- `V` = variable infrastructure cost allocated to that request
- `F` = payment fee and other percentage-based fee fraction of sale price
- `M` = desired gross margin as a fraction of revenue
- `P` = customer price before tax

Then approximate:

```text
P = (C + V) / (1 - F - M)
```

Example only: if `C + V = $1.00`, percentage fees are 3%, and target gross margin is 40%:

```text
P = $1.00 / (1 - 0.03 - 0.40)
  = $1.00 / 0.57
  ≈ $1.75
```

This is a unit-economics example, not a universal markup. Fixed fees, taxes, refunds, failed requests, fraud, and support can reduce realized margin further.

## Recommended guardrails for managed credits

1. Begin with prepaid credits, not postpaid unlimited usage.
2. Show separate input/output rates per model.
3. Set per-run and daily/monthly spending caps.
4. Require explicit confirmation for unusually expensive runs.
5. Warn before long-context or high-output tasks.
6. Apply retry budgets and idempotency to prevent duplicate charges.
7. Do not bill the user for provider failures unless a clearly disclosed policy and provider charge support it.
8. Reconcile estimates with provider-reported usage.
9. Set a maximum exposure per user and per provider key.
10. Maintain an emergency kill switch for a provider/model.
11. Keep a reserve for refunds and unexpected provider invoice changes.
12. Review pricing whenever provider prices or payment fees change.

## Pricing positioning

- **Best early offer:** “TIKI IDE subscription; bring your own API key” to keep economics predictable.
- **Best expansion:** optional managed credits for selected models, with clear per-model usage.
- **Avoid initially:** “all models unlimited for a low monthly fee.”
- **Differentiator:** unify workflows and visibility, not promise the cheapest token on every model.
- **Do not use a universal multiplier blindly:** cheap models and expensive reasoning models have different risk profiles. Apply per-model cost floors and margin targets.

---

# 10. Production cost budget template

Fill this in with measured figures before setting final prices.

| Cost category | Monthly estimate | How to measure |
|---|---:|---|
| App hosting / VPS | Rp___ | Provider invoice |
| Database / backups | Rp___ | Actual plan and storage |
| Object storage / logs | Rp___ | Usage dashboard |
| Monitoring / error tracking | Rp___ | Tool invoice |
| Domain / email | Rp___ | Annual cost divided monthly |
| Payment fees | ___% + Rp___ | Payment provider tariff |
| Variable provider tokens | Rp___ | Usage ledger and provider invoice |
| External APIs / search | Rp___ | Provider invoice |
| Support / moderation | Rp___ | Hours × internal cost |
| Refund / fraud reserve | Rp___ | Observed rate or conservative allowance |
| Taxes / accounting / legal | Rp___ | Qualified local advice |
| Development / maintenance | Rp___ | Hours × target rate |
| Total fixed cost | Rp___ | Sum fixed items |
| Total variable cost | Rp___ | Sum per-user/request items |

Measure costs per active user, per completed run, and per unit of useful output—not only per token.

---

# 11. Production data, privacy, and legal checklist

Before taking payment or hosting user projects:
- Write clear Terms of Service, Privacy Policy, acceptable-use policy, refund policy, and data retention policy.
- State whether prompts, source code, logs, and provider credentials leave the user's device.
- Minimize stored source code and redact secrets from diagnostics.
- Define deletion/export procedures for workspaces and usage history.
- Confirm provider terms allow the intended resale/proxy model.
- Review API provider restrictions, rate limits, data handling, and commercial-use terms.
- Review applicable Indonesian consumer, privacy, tax, and electronic-system obligations with qualified local counsel/accounting support.
- Use age-appropriate account/payment flows and avoid collecting unnecessary personal data.
- Make telemetry opt-in where feasible and document exactly what is collected.
- Provide a security contact and incident-response procedure.

This section is a checklist, not legal advice.

---

# 12. Observability, reliability, and release metrics

Track these metrics without collecting unnecessary private code/content:
- Successful run completion rate.
- Adapter connection and reconnect success rate.
- Time to first event and time to first useful output.
- Event loss/duplicate/replay rates.
- Cancellation success rate.
- Tool timeout and failure rate.
- Diff correctness and restore success.
- Test/build pass rates.
- Crash-free sessions and memory growth in long sessions.
- Provider usage reconciliation difference.
- Actual gross margin by model and plan.
- Support tickets per active user.
- Release rollback frequency.

Suggested internal quality goals (set after baseline measurement):
- No known critical security issue at release.
- No fake “success” states.
- No silent file overwrite.
- Every shipped adapter passes conformance tests.
- Every paid request has a traceable usage record or an explicit “usage unavailable” state.
- All supported platforms pass the published smoke test.

---

# 13. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Provider APIs differ or change | Broken adapters | Capability manifest, contract tests, versioned adapters |
| Native events unavailable | Misleading progress | Mark inferred events; use observable process events only |
| Concurrent agents conflict | Lost code | Workspace/branch isolation, diff review, locks where needed |
| Malicious repo/tool output | Unsafe actions | Treat content as untrusted; policy gates and least privilege |
| Local IDE exposed remotely | Workspace compromise | Loopback default, auth, explicit remote-mode setup |
| Token usage exceeds sale price | Negative margin | Per-model ledger, budgets, prepaid credits, kill switch |
| Provider price changes | Margin erosion | Versioned price tables, alerts, frequent reconciliation |
| Too much abstraction | Slow development | First ship one working vertical slice |
| UI performance degrades | Poor UX on low-end devices | Virtualization, lazy loading, profiling |
| Unsupported platform claims | Failed installs | Published compatibility matrix and platform tests |
| Tool/API terms prohibit use | Legal/business risk | Verify terms and use official/licensed providers |
| Secret leakage in logs | Credential compromise | Redaction tests and minimal retention |

---

# 14. Definition of Done

A feature is not complete because its button appears in the UI.

A feature is done only when:
- It performs a real operation against a real implementation.
- Success and failure are both handled.
- Its data source is observable and truthful.
- Inputs and outputs are validated.
- Permissions are enforced server-side.
- Secrets are protected.
- Tests cover its important paths.
- Documentation explains setup, limits, and troubleshooting.
- It behaves acceptably on the environments claimed as supported.
- The capability matrix is updated to match reality.

## Non-negotiable principle

**The agent event stream, tool execution records, and filesystem diffs must share a consistent source of truth.** If an agent claims it edited a file but no corresponding change exists, TIKI must show the mismatch instead of displaying a false success state.

---

# 15. Immediate next actions

1. Audit the current MVP repository and update the capability matrix.
2. Pick one real agent runtime as the first supported vertical slice.
3. Implement canonical run/event contracts and durable event IDs.
4. Stream real activity to the UI and verify reconnect/replay.
5. Add filesystem snapshots and a correct live diff/review flow.
6. Add run history, cancellation, and reliable error states.
7. Add one production-grade non-AI connector with permissions and tests.
8. Implement the real MCP client only after the core event/tool lifecycle is stable.
9. Implement sub-agent orchestration with isolated workspaces.
10. Add usage ledger and provider price snapshots before managed-token billing.
11. Launch a BYOK beta first; validate demand, UX, and support load.
12. Add managed credits only after actual costs and abuse limits are measured.

**Recommended first release objective:** one real agent adapter + truthful live activity + verified file diffs + safe local workspace + repeatable installation. This vertical slice is more valuable than a broad dashboard with incomplete integrations.


# 16. TIKI-owned prompt architecture

TIKI owns the product-level system prompt. Agent runtimes such as OpenCode, Hermes, and OpenClaw are execution providers/adapters. They do not own TIKI's identity, task framing, or product-level prompt configuration.

## Prompt layers

1. **TIKI Core Prompt** — version-controlled in `core/system-prompt.md`; defines execution behavior, truthful reporting, workspace safety, and final response expectations.
2. **TIKI Runtime Contract** — appended by the server for every run; reinforces observable behavior, boundaries, and truthful progress reporting.
3. **User Custom Instructions** — optional instructions managed in the TIKI UI and stored in the TIKI config directory, not in the project repository by default.
4. **Current User Task** — passed separately from system instructions whenever the provider API supports separate roles.
5. **Provider Runtime Policy** — provider-specific internal policies may still apply; TIKI cannot remove or guarantee precedence over policies owned by a remote runtime.

## Requirements

- All adapters receive the same effective TIKI prompt and a prompt version fingerprint.
- OpenAI-compatible adapters use a system message plus a separate user message.
- Native adapters must use the supported system/developer configuration of that runtime. If unsupported, document a fallback and its limitations instead of claiming parity.
- Prompt changes are saved with restrictive local file permissions where supported.
- Every run emits a prompt-attached event and records the effective prompt version.
- Never log provider keys or secrets in prompts. Avoid sending unnecessary project data to the model.
- Project files and tool outputs remain untrusted data; prompt instructions do not replace filesystem, command, network, or tool permission enforcement.
- Keep product-owned core instructions separate from optional user custom instructions.
- Add adapter contract tests proving the effective prompt reaches each provider in the expected request field.

## Acceptance gate

A mock-provider integration test verifies that (a) the TIKI core prompt is present, (b) custom instructions are appended, (c) the user's task remains a separate message when supported, (d) the prompt version changes when configuration changes, and (e) provider errors do not result in false success events.
