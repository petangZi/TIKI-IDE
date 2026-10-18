/* TIKI Universal IDE — single-page client. No framework, no build step. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString([], { hour12: false }); };

const State = {
  workspace: null, agents: [], selectedAgent: null, tools: [], runs: [], tasks: [],
  openTabs: [], activeTab: null, dirty: new Map(), fileContents: new Map(),
  files: [], treeEntries: [], lastEventId: 0, eventSource: null, approvals: [], mcpServers: [],
  subagents: [], prompt: null, runtime: null, paletteItems: [], paletteIndex: 0,
  theme: localStorage.getItem("tiki-theme") || "dark"
};

/* ------------------------------------------------------------------ API */
async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) headers["x-tiki-csrf"] = "1";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const err = new Error(data?.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

/* --------------------------------------------------------------- toasts */
function toast(message, kind = "info", ms = 3600) {
  const t = el("div", `toast ${kind}`);
  t.textContent = message;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 220); }, ms);
}

/* ----------------------------------------------------------------- SSE */
const EVENT_KIND = (type) => {
  if (type.startsWith("run.")) return "run";
  if (type.startsWith("agent.")) return "agent";
  if (type.startsWith("tool.")) return "tool";
  if (type.startsWith("file.") || type.startsWith("diff.")) return "file";
  if (type.startsWith("usage.") || type.startsWith("cost.")) return "usage";
  if (type.includes("fail") || type.includes("error") || type.includes("cancel")) return "err";
  return "";
};
const EVENT_ICON = { run: "▶", agent: "◆", tool: "⚙", file: "≡", usage: "$", err: "!", "": "•" };

// The bus writes `event: <type>` frames, which EventSource dispatches as NAMED
// events (never via onmessage). Register a listener for every contract type.
const SSE_TYPES = [
  "run.queued", "run.started", "run.waiting_approval", "run.completed", "run.failed", "run.cancelled",
  "agent.status", "agent.message.delta", "agent.message.completed",
  "plan.created", "task.created", "task.started", "task.completed", "task.blocked",
  "tool.requested", "tool.approval_required", "tool.started", "tool.output.delta", "tool.completed", "tool.failed",
  "file.read", "file.created", "file.changed", "file.deleted", "diff.updated",
  "terminal.started", "terminal.output", "terminal.exit",
  "test.started", "test.result", "build.started", "build.result",
  "usage.reported", "cost.updated",
  "connection.lost", "connection.restored", "warning.created",
  "prompt.attached", "prompt.updated",
  "command.started", "command.completed", "subagent.added", "subagent.removed", "subagent.updated", "snapshot"
];

function connectStream() {
  if (State.eventSource) State.eventSource.close();
  const es = new EventSource(`/api/events${State.lastEventId ? `?lastEventId=${State.lastEventId}` : ""}`);
  State.eventSource = es;
  const dot = $("#connDot"), text = $("#connText");
  const live = (on) => { dot.className = `dot-live${on ? " on" : " off"}`; $("#streamDot")?.setAttribute("class", `dot-live${on ? " on" : " off"}`); };
  es.addEventListener("open", () => { text.textContent = "Live"; live(true); });
  es.addEventListener("connected", (e) => {
    const d = JSON.parse(e.data);
    if (d.sequence) State.lastEventId = d.sequence;
    text.textContent = d.replayed ? `Live · replay ${d.replayed}` : "Live";
    live(true);
  });
  const dispatch = (e) => { try { handleEvent(JSON.parse(e.data)); } catch { /* non-JSON keepalive frames are expected */ } };
  for (const type of SSE_TYPES) es.addEventListener(type, dispatch);
  es.onmessage = dispatch;
  es.onerror = () => { text.textContent = "Reconnecting…"; live(false); };
}

function handleEvent(ev) {
  if (ev.sequence) State.lastEventId = ev.sequence;
  if (ev.type === "agent.message.delta") { appendAgentDelta(ev); return; }
  addTimeline(ev);
  if (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.cancelled") { refreshRuns(); refreshUsage(); }
  if (ev.type.startsWith("file.") || ev.type === "diff.updated") scheduleTreeRefresh();
  if (ev.type === "tool.approval_required") { pollApprovals(); }
  if (ev.type.startsWith("task.")) refreshTasks();
}

let treeRefreshTimer = null;
function scheduleTreeRefresh() {
  clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(loadTree, 600);
}

/* ------------------------------------------------------------- timeline */
function addTimeline(ev) {
  const box = $("#timeline");
  if (box.querySelector(".empty")) box.innerHTML = "";
  if (isFilteredOut(ev)) return;
  const kind = EVENT_KIND(ev.type);
  const row = el("div", `ev ${kind}`);
  row.dataset.kind = kind;
  row.innerHTML = `<div class="t">${fmtTime(ev.timestamp || ev.at)}</div><div class="dot">${EVENT_ICON[kind] || "•"}</div>
    <div class="body"><div class="kind">${esc(ev.type)}</div><div class="msg">${esc(ev.payload?.text || ev.text || "")}</div></div>`;
  box.appendChild(row);
  while (box.children.length > 600) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}
function isFilteredOut(ev) {
  const filter = $("#activityFilter")?.value || "";
  return filter && EVENT_KIND(ev.type) !== filter;
}
function appendAgentDelta(ev) {
  const box = $("#timeline");
  const last = box.querySelector(".ev.agent:last-child .msg");
  if (last && last.dataset.streaming === "1") { last.textContent += ev.payload?.text || ev.text || ""; box.scrollTop = box.scrollHeight; }
}

/* ------------------------------------------------------------ file tree */
async function loadTree() {
  try {
    const data = await api("/api/tree");
    State.workspace = data.root || State.workspace;
    $("#wsPath").textContent = data.root || "—";
    State.treeEntries = data.entries;
    State.files = data.entries.filter((e) => e.type === "file");
    renderTree();
    $("#wsFiles").textContent = `${State.files.length} files`;
  } catch (e) { $("#fileTree").innerHTML = `<div class="empty"><b>Tree unavailable</b><p>${esc(e.message)}</p></div>`; }
}
function renderTree() {
  const tree = $("#fileTree"); tree.innerHTML = "";
  const filter = ($("#fileFilter").value || "").toLowerCase();
  const rows = (State.treeEntries || []).filter((e) => !filter || e.path.toLowerCase().includes(filter));
  if (!rows.length) { tree.innerHTML = `<div class="empty"><b>No matches</b></div>`; return; }
  for (const e of rows.slice(0, 1500)) {
    const row = el("div", "tree-row" + (e.path === State.activeTab ? " active" : ""));
    row.dataset.path = e.path;
    row.innerHTML = `<span class="ico">${e.type === "dir" ? "▸" : "·"}</span><span class="nm">${esc(e.name)}</span>${e.type === "file" ? `<span class="sz">${fmtBytes(e.size)}</span>` : ""}`;
    row.addEventListener("click", () => { if (e.type === "file") openFile(e.path); });
    tree.appendChild(row);
  }
}

/* -------------------------------------------------------------- editor */
async function openFile(p) {
  if (!State.openTabs.includes(p)) State.openTabs.push(p);
  State.activeTab = p;
  renderTabs();
  showView("editor");
  $("#crumb").textContent = p;
  try {
    const file = await api(`/api/file?path=${encodeURIComponent(p)}`);
    State.fileContents.set(p, file.content ?? "");
    $("#editorPath").textContent = p;
    $("#editorBadge").textContent = file.binary ? "binary" : "editable";
    $("#editor").value = file.binary ? "‹ binary file ›" : (file.content ?? "");
    $("#editor").readOnly = !!file.binary;
    $("#editorInfo").textContent = `${fmtBytes(file.size)} · sha ${file.hash}`;
    State.dirty.set(p, false);
    updateGutter(); updateDirty();
    $$("#fileTree .tree-row").forEach((r) => r.classList.toggle("active", r.dataset.path === p));
  } catch (e) { toast(`Open failed: ${e.message}`, "err"); }
}
function renderTabs() {
  const tabs = $("#tabs"); tabs.innerHTML = "";
  for (const p of State.openTabs) {
    const tab = el("div", `tab${p === State.activeTab ? " active" : ""}`);
    const name = p.split("/").pop();
    tab.innerHTML = `${State.dirty.get(p) ? '<span class="dot"></span>' : ""}<span>${esc(name)}</span><span class="x" title="Close">×</span>`;
    tab.addEventListener("click", (e) => { if (e.target.classList.contains("x")) closeTab(p); else openFile(p); });
    tabs.appendChild(tab);
  }
  const add = el("button", "icon-btn"); add.textContent = "＋"; add.title = "New task tab";
  add.addEventListener("click", () => showView("console"));
  tabs.appendChild(add);
}
function closeTab(p) {
  State.openTabs = State.openTabs.filter((x) => x !== p);
  if (State.activeTab === p) State.activeTab = State.openTabs[State.openTabs.length - 1] || null;
  if (State.activeTab) openFile(State.activeTab); else showView("console");
  renderTabs();
}
function updateGutter() {
  const lines = ($("#editor").value.match(/\n/g)?.length || 0) + 1;
  const g = $("#gutter"); g.innerHTML = "";
  for (let i = 1; i <= lines; i++) g.appendChild(el("div", null, String(i)));
  g.scrollTop = $("#editor").scrollTop;
}
function updateDirty() {
  const p = State.activeTab;
  if (!p) return;
  const isDirty = State.dirty.get(p);
  $("#editorDirty").textContent = isDirty ? "● unsaved" : "saved";
  renderTabs();
}
async function saveFile() {
  const p = State.activeTab;
  if (!p) return;
  const content = $("#editor").value;
  try {
    const r = await api("/api/file", { method: "POST", body: { path: p, content } });
    State.dirty.set(p, false); updateDirty();
    toast(`Saved ${r.path}`, "ok");
  } catch (e) { toast(`Save failed: ${e.message}`, "err"); }
}

/* -------------------------------------------------------------- views */
function showView(name) {
  for (const v of ["console", "editor", "diff", "terminal", "tasks"]) {
    $(`#view-${v}`).hidden = v !== name;
  }
  if (name === "console") $("#crumb").textContent = "Agent Console";
  if (name === "diff") $("#crumb").textContent = "Diff";
  if (name === "terminal") $("#crumb").textContent = "Terminal";
  if (name === "tasks") $("#crumb").textContent = "Tasks";
}

/* ------------------------------------------------------------- agents */
async function loadAgents() {
  try {
    const { agents } = await api("/api/runtime");
    State.agents = agents;
    renderAgents();
    $("#wsRuntime").textContent = `${agents.filter((a) => a.detected).length}/${agents.length} online`;
  } catch (e) { toast(`Detect failed: ${e.message}`, "err"); }
}
function renderAgents() {
  const strip = $("#agents"); strip.innerHTML = "";
  const panelList = $("#agentPanelList"); panelList.innerHTML = "";
  const saAdapter = $("#saAdapter"); saAdapter.innerHTML = "";
  const taskAgent = $("#taskAgent"); taskAgent.innerHTML = "";
  if (!State.selectedAgent) State.selectedAgent = State.agents.find((a) => a.detected)?.id || State.agents[0]?.id;
  for (const a of State.agents) {
    const card = el("div", `agent-card${a.id === State.selectedAgent ? " selected" : ""}`);
    card.innerHTML = `<div class="an">${esc(a.name)} <span class="pill ${a.detected ? "ok" : ""}">${a.detected ? "online" : "offline"}</span></div>
      <div class="ad">${esc(a.detail || a.kind)}</div>
      <div class="caps">${Object.entries(a.capabilities || {}).filter(([, v]) => v).slice(0, 4).map(([k]) => `<span class="pill">${k}</span>`).join("")}</div>`;
    card.addEventListener("click", () => { State.selectedAgent = a.id; renderAgents(); });
    strip.appendChild(card);

    const li = el("div", "list-item");
    li.innerHTML = `<span class="dot-live ${a.detected ? "on" : "off"}"></span><div class="grow"><div class="nm">${esc(a.name)}</div><div class="sub">${esc(a.detail || a.kind)}</div></div>`;
    panelList.appendChild(li);

    saAdapter.appendChild(el("option", null, a.name)).value = a.id;
    const op = el("option", null, a.name); op.value = a.id; taskAgent.appendChild(op);
  }
  $("#selAgentLabel").textContent = `Agent: ${State.agents.find((a) => a.id === State.selectedAgent)?.name || "—"}`;
}

async function runAgent() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) return;
  const btn = $("#sendPrompt"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Running…';
  showView("console");
  const agent = State.selectedAgent;
  try {
    if ($("#queueMode").checked) {
      const r = await api("/api/runs", { method: "POST", body: { agent, prompt } });
      toast(`Queued run ${r.run_id.slice(0, 8)}`, "info");
    } else {
      const r = await api("/api/chat", { method: "POST", body: { agent, prompt } });
      toast(`Run ${r.run_id.slice(0, 8)} completed`, "ok");
      if (r.diff && (r.diff.counts.added + r.diff.counts.modified + r.diff.counts.deleted) > 0) {
        State.lastDiff = r.diff; renderDiff(r.diff); toast("Workspace changed — open Diff", "info");
      }
    }
    $("#prompt").value = "";
    refreshRuns(); refreshUsage(); loadTree();
  } catch (e) { toast(`Run failed: ${e.message}`, "err"); }
  finally { btn.disabled = false; btn.innerHTML = 'Run agent <span>↗</span>'; }
}

async function refreshRuns() {
  try {
    const { runs } = await api("/api/runs?limit=30");
    State.runs = runs;
    const list = $("#runsList"); list.innerHTML = "";
    if (!runs.length) { list.innerHTML = `<div class="empty"><b>No runs yet</b></div>`; return; }
    for (const r of runs) {
      const li = el("div", "list-item");
      const statusPill = { completed: "ok", failed: "err", cancelled: "warn", running: "accent", queued: "" }[r.status] || "";
      li.innerHTML = `<div class="grow"><div class="nm nowrap">${esc(r.prompt.slice(0, 60) || r.id)}</div>
        <div class="sub">${esc(r.agent_id)} · ${fmtTime(r.created_at)} · ${r.id.slice(0, 8)}</div></div>
        <span class="pill ${statusPill}">${esc(r.status)}</span>`;
      if (["running", "queued", "waiting_approval"].includes(r.status)) {
        const cancel = el("button", "btn sm danger"); cancel.textContent = "Stop";
        cancel.addEventListener("click", async () => { try { await api(`/api/runs/${r.id}/cancel`, { method: "POST" }); refreshRuns(); } catch (e) { toast(e.message, "err"); } });
        li.appendChild(cancel);
      }
      li.addEventListener("click", async (e) => { if (e.target.tagName === "BUTTON") return; try { const d = await api(`/api/runs/${r.id}`); openRunDetail(d.run); } catch {} });
      list.appendChild(li);
    }
  } catch {}
}
function openRunDetail(run) { $("#crumb").textContent = `Run ${run.id.slice(0, 8)} · ${run.status}`; }

/* --------------------------------------------------------------- diff */
function renderDiff(diff) {
  showView("diff");
  const body = $("#diffBody"); body.innerHTML = "";
  if (!diff || !diff.files?.length) { body.innerHTML = `<div class="empty"><div class="ei">≋</div><b>No changes</b><p>The workspace matches the run baseline.</p></div>`; return; }
  const summary = el("div", "card-body");
  summary.innerHTML = `<div class="field-row" style="gap:10px"><span class="pill ok">+${diff.additions} additions</span><span class="pill err">-${diff.deletions} deletions</span><span class="pill">${diff.files.length} files</span></div>`;
  body.appendChild(summary);
  for (const f of diff.files) {
    const card = el("div", "diff-file");
    const head = el("div", "diff-head");
    head.innerHTML = `<span class="pill ${f.status === "added" ? "ok" : f.status === "deleted" ? "err" : "warn"}">${f.status}</span>
      <span class="path">${esc(f.path)}</span>
      <span class="stat"><span class="add-n">+${f.additions || 0}</span><span class="del-n">-${f.deletions || 0}</span></span>`;
    card.appendChild(head);
    if (f.binary) { card.appendChild(el("div", "hunk-head", "binary file (not shown)")); }
    for (const h of f.hunks || []) {
      card.appendChild(el("div", "hunk-head", h.header));
      const lines = el("div", "diff-lines");
      for (const l of h.lines) {
        const cls = l.t === "+" ? "add" : l.t === "-" ? "del" : "";
        const row = el("div", `diff-line ${cls}`);
        row.innerHTML = `<span class="ln">${l.aLine ?? ""}</span><span class="ln">${l.bLine ?? ""}</span><span class="sign">${esc(l.t)}</span><span class="tx">${esc(l.text)}</span>`;
        lines.appendChild(row);
      }
      card.appendChild(lines);
    }
    body.appendChild(card);
  }
}
async function captureDiff() {
  try { const d = await api("/api/diff", { method: "POST" }); renderDiff(d); }
  catch (e) { toast(e.message, "err"); }
}

/* ----------------------------------------------------------- terminal */
async function loadCommands() {
  try {
    const { commands } = await api("/api/commands");
    const sel = $("#cmdSelect"); sel.innerHTML = "";
    for (const c of commands) { const o = el("option", null, c.id + (c.approval ? " (approval)" : "")); o.value = c.id; sel.appendChild(o); }
  } catch {}
}
async function runCommand() {
  const command = $("#cmdSelect").value;
  if (!command) return;
  const term = $("#terminal");
  term.innerHTML += `\n<span class="cmd">$ ${esc(command)}</span>\n`;
  term.scrollTop = term.scrollHeight;
  try {
    const r = await api("/api/command", { method: "POST", body: { command } });
    term.innerHTML += esc(r.output || "(no output)") + `\n`;
  } catch (e) {
    term.innerHTML += `<span class="err">[error] ${esc(e.message)}</span>\n`;
    if (e.status === 403) pollApprovals();
  }
  term.scrollTop = term.scrollHeight;
}

/* ------------------------------------------------------------- tasks */
async function refreshTasks() {
  try {
    const { tasks, stats } = await api("/api/tasks");
    State.tasks = tasks;
    $("#taskStats").textContent = `${stats.total} tasks · ${stats.running} running`;
    const cols = { pending: [], running: [], completed: [], failed: [] };
    for (const t of tasks) (cols[t.status === "blocked" ? "failed" : t.status] ||= []).push(t);
    const board = $("#board"); board.innerHTML = "";
    for (const [name, items] of Object.entries(cols)) {
      const col = el("div", "col");
      col.innerHTML = `<div class="col-head"><span>${name}</span><span>${items.length}</span></div>`;
      const body = el("div", "col-body");
      for (const t of items) {
        const card = el("div", "task");
        card.innerHTML = `<div class="tt">${esc(t.title)}</div><div class="tm">${esc(t.id)} · ${fmtTime(t.created_at)}${t.depends_on.length ? " · deps:" + t.depends_on.length : ""}</div>`;
        body.appendChild(card);
      }
      col.appendChild(body); board.appendChild(col);
    }
  } catch {}
}
async function addTask() {
  const prompt = $("#taskPrompt").value.trim();
  if (!prompt) { toast("Task prompt required", "err"); return; }
  const deps = ($("#taskDeps").value || "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    await api("/api/tasks", { method: "POST", body: { title: $("#taskTitle").value.trim() || prompt.slice(0, 60), agent: $("#taskAgent").value, prompt, depends_on: deps } });
    $("#taskPrompt").value = ""; $("#taskTitle").value = ""; $("#taskDeps").value = "";
    toast("Task queued", "ok"); refreshTasks();
  } catch (e) { toast(e.message, "err"); }
}

/* --------------------------------------------------------- subagents */
async function loadSubagents() {
  try {
    const { subagents } = await api("/api/subagents");
    State.subagents = subagents;
    const list = $("#subagentsList"); list.innerHTML = "";
    if (!subagents.length) { list.innerHTML = `<div class="empty"><b>None yet</b></div>`; return; }
    for (const s of subagents) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(s.name)}</div><div class="sub">${esc(s.role)} · ${esc(s.adapter)}${s.model ? " · " + esc(s.model) : ""}</div></div>
        <span class="pill ${s.enabled ? "ok" : ""}">${s.enabled ? "on" : "off"}</span>`;
      const toggle = el("button", "btn sm ghost"); toggle.textContent = s.enabled ? "Disable" : "Enable";
      toggle.addEventListener("click", async () => { await api(`/api/subagents/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }); loadSubagents(); });
      const del = el("button", "btn sm danger"); del.textContent = "×";
      del.addEventListener("click", async () => { await api(`/api/subagents/${s.id}`, { method: "DELETE" }); loadSubagents(); });
      li.append(toggle, del); list.appendChild(li);
    }
  } catch {}
}
async function addSubagent() {
  try {
    await api("/api/subagents", { method: "POST", body: { name: $("#saName").value, role: $("#saRole").value, adapter: $("#saAdapter").value, model: $("#saModel").value } });
    $("#saName").value = ""; $("#saModel").value = "";
    toast("Sub-agent added", "ok"); loadSubagents();
  } catch (e) { toast(e.message, "err"); }
}

/* ------------------------------------------------------------- tools */
async function loadTools() {
  try {
    const { tools } = await api("/api/tools");
    State.tools = tools;
    const list = $("#toolsList"); list.innerHTML = "";
    const sel = $("#toolSelect"); sel.innerHTML = "";
    for (const t of tools) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(t.label)} <span class="pill">${esc(t.category)}</span></div><div class="sub">${esc(t.id)} · v${esc(t.version)}${t.network ? " · network" : ""}</div></div>`;
      list.appendChild(li);
      const o = el("option", null, t.id); o.value = t.id; sel.appendChild(o);
    }
    sel.value = "weather.current";
  } catch {}
}
async function invokeTool() {
  const id = $("#toolSelect").value;
  let args = {};
  try { args = $("#toolArgs").value.trim() ? JSON.parse($("#toolArgs").value) : {}; }
  catch { toast("Args must be valid JSON", "err"); return; }
  $("#toolResult").textContent = "Running…";
  try { const r = await api(`/api/tools/${id}/invoke`, { method: "POST", body: { args } }); $("#toolResult").textContent = JSON.stringify(r, null, 2); }
  catch (e) { $("#toolResult").textContent = `Error: ${e.message}`; }
}

/* --------------------------------------------------------------- MCP */
async function loadMcp() {
  try {
    const { servers } = await api("/api/mcp/servers");
    State.mcpServers = servers;
    const list = $("#mcpList"); list.innerHTML = "";
    if (!servers.length) { list.innerHTML = `<div class="empty"><b>No MCP servers</b></div>`; }
    for (const s of servers) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(s.name)} ${s.trust === "trusted" ? '<span class="pill warn">trusted</span>' : '<span class="pill">untrusted</span>'} ${s.builtin ? '<span class="pill">built-in</span>' : ''}</div>
        <div class="sub">${esc(s.url || `${s.command} ${(s.args || []).join(" ")}`)} · ${esc(s.status)}</div></div>`;
      const connect = el("button", "btn sm"); connect.textContent = "Connect";
      connect.addEventListener("click", async () => { try { await api(`/api/mcp/servers/${s.id}/connect`, { method: "POST" }); const d = await api(`/api/mcp/servers/${s.id}/describe`); toast(`${d.tools.length} tools discovered`, "ok"); loadMcp(); } catch (e) { toast(e.message, "err"); } });
      const trust = el("button", "btn sm ghost");
      trust.textContent = s.trust === "trusted" ? "Untrust" : "Trust";
      trust.title = s.trust === "trusted" ? "Tool calls allowed" : "Mark trusted to allow tool calls";
      trust.addEventListener("click", async () => {
        try { await api(`/api/mcp/servers/${s.id}`, { method: "PATCH", body: { trust: s.trust === "trusted" ? "untrusted" : "trusted" } }); loadMcp(); }
        catch (e) { toast(e.message, "err"); }
      });
      const del = el("button", "btn sm danger"); del.textContent = "×";
      del.addEventListener("click", async () => { await api(`/api/mcp/servers/${s.id}`, { method: "DELETE" }); loadMcp(); });
      li.append(connect, trust, del); list.appendChild(li);
    }
    refreshMcpBuiltins();
  } catch {}
}
async function refreshMcpBuiltins() {
  const box = $("#mcpBuiltins"); if (!box) return;
  try {
    const { builtins } = await api("/api/mcp/builtins");
    box.innerHTML = "";
    for (const b of builtins) {
      const li = el("div", "list-item");
      const transport = b.transport === "bundle" ? "bundle" : b.transport;
      const badge = b.installed ? '<span class="pill ok">installed</span>' : (b.transport !== "bundle" && !b.ready ? '<span class="pill warn">needs config</span>' : '');
      li.innerHTML = `<div class="grow"><div class="nm">${esc(b.name)} <span class="pill">${esc(transport)}</span> ${badge}</div>
        <div class="sub">${esc(String(b.description || "").slice(0, 160))}</div>${b.note ? `<div class="sub">⚠ ${esc(String(b.note).slice(0, 200))}</div>` : ""}</div>`;
      if (b.transport === "bundle") {
        const btn = el("button", "btn sm"); btn.textContent = "Add children";
        btn.addEventListener("click", async () => {
          for (const c of b.children || []) { try { await api(`/api/mcp/builtins/${encodeURIComponent(c.id)}/install`, { method: "POST", body: {} }); } catch (e) { toast(e.message, "err"); } }
          toast("Bundle children added", "ok"); loadMcp();
        });
        li.appendChild(btn);
      } else if (!b.installed) {
        const btn = el("button", "btn sm primary"); btn.textContent = "Install";
        btn.addEventListener("click", async () => { try { await api(`/api/mcp/builtins/${encodeURIComponent(b.id)}/install`, { method: "POST", body: {} }); toast("Installed — connect to see tools", "ok"); loadMcp(); } catch (e) { toast(e.message, "err"); } });
        li.appendChild(btn);
      }
      box.appendChild(li);
    }
    if (!builtins.length) box.innerHTML = `<div class="empty"><b>No built-ins</b></div>`;
  } catch {}
}
async function addMcp() {
  try {
    await api("/api/mcp/servers", { method: "POST", body: { name: $("#mcpName").value, command: $("#mcpCommand").value, args: ($("#mcpArgs").value || "").split(",").map((s) => s.trim()).filter(Boolean), trust: $("#mcpTrust").checked ? "trusted" : "untrusted" } });
    $("#mcpName").value = ""; $("#mcpCommand").value = ""; $("#mcpArgs").value = "";
    toast("MCP server added", "ok"); loadMcp();
  } catch (e) { toast(e.message, "err"); }
}

/* --------------------------------------------------------------- Skills */
async function loadSkills() {
  const box = $("#skillBuiltins"); if (!box) return;
  try {
    const [{ builtins }, { skills }] = await Promise.all([api("/api/skills/builtins"), api("/api/skills")]);
    box.innerHTML = "";
    for (const s of builtins) {
      const li = el("div", "list-item");
      const badge = s.installed ? '<span class="pill ok">installed</span>' : '';
      li.innerHTML = `<div class="grow"><div class="nm">${esc(s.name)} ${badge}</div>
        <div class="sub">${esc(String(s.description || "").slice(0, 170))}</div>
        <div class="sub"><code>${esc(s.install)}</code></div></div>`;
      const btn = el("button", "btn sm primary");
      btn.textContent = s.installed ? "Copy cmd" : "Install";
      btn.addEventListener("click", async () => {
        try {
          if (!s.installed) await api(`/api/skills/builtins/${encodeURIComponent(s.id)}/install`, { method: "POST", body: {} });
          try { await navigator.clipboard.writeText(s.install); } catch {}
          toast("Command copied — run it in your terminal", "ok");
          loadSkills();
        } catch (e) { toast(e.message, "err"); }
      });
      li.appendChild(btn); box.appendChild(li);
    }
    if (!builtins.length) box.innerHTML = `<div class="empty"><b>No built-ins</b></div>`;

    const installedBox = $("#skillInstalled"); installedBox.innerHTML = "";
    if (!skills.length) { installedBox.innerHTML = `<div class="empty"><b>None yet</b></div>`; }
    for (const s of skills) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(s.name)}</div><div class="sub"><code>${esc(s.installCommand)}</code></div></div>`;
      const del = el("button", "btn sm danger"); del.textContent = "×";
      del.addEventListener("click", async () => { try { await api(`/api/skills/${encodeURIComponent(s.id)}`, { method: "DELETE" }); loadSkills(); } catch (e) { toast(e.message, "err"); } });
      li.appendChild(del); installedBox.appendChild(li);
    }
  } catch {}
}

/* ------------------------------------------------------------- usage */
async function refreshUsage() {
  try {
    const s = await api("/api/usage/summary");
    $("#usageStats").innerHTML = `
      <div class="stat"><div class="sl">Runs</div><div class="sv">${s.runs}</div></div>
      <div class="stat"><div class="sl">Records</div><div class="sv">${s.records}</div></div>
      <div class="stat"><div class="sl">Provider cost</div><div class="sv">$${s.provider_cost.toFixed(4)}</div></div>
      <div class="stat"><div class="sl">User charge</div><div class="sv">$${s.user_charge.toFixed(4)}</div></div>
      <div class="stat"><div class="sl">Input tok</div><div class="sv">${s.input_tokens}</div></div>
      <div class="stat"><div class="sl">Output tok</div><div class="sv">${s.output_tokens}</div></div>`;
    $("#markupInput").value = s.markup;
    const { records } = await api("/api/usage?limit=40");
    const list = $("#usageList"); list.innerHTML = "";
    if (!records.length) { list.innerHTML = `<div class="empty"><b>No usage recorded</b></div>`; return; }
    for (const r of records) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(r.provider)}/${esc(r.model)}</div><div class="sub">in ${r.input_tokens ?? "–"} · out ${r.output_tokens ?? "–"} · $${(r.final_user_charge || 0).toFixed(5)}</div></div>`;
      list.appendChild(li);
    }
  } catch {}
}

/* ------------------------------------------------------------ prompt */
async function loadPrompt() {
  try {
    const p = await api("/api/system-prompt");
    State.prompt = p;
    $("#promptVersion").textContent = p.version;
    $("#corePrompt").textContent = p.corePrompt;
    $("#customPrompt").value = p.customInstructions || "";
    $("#promptChars").textContent = `${(p.customInstructions || "").length} / 30,000`;
  } catch {}
}

/* ------------------------------------------------------------ system */
async function loadSystem() {
  try {
    const [rt, caps, audit] = await Promise.all([api("/api/runtime"), api("/api/capabilities"), api("/api/audit?limit=30")]);
    State.runtime = rt;
    const kv = $("#systemKv");
    kv.innerHTML = `
      <dt>Platform</dt><dd>${esc(rt.platform)}/${esc(rt.arch)}</dd>
      <dt>Node</dt><dd>${esc(rt.node)}</dd>
      <dt>PID</dt><dd>${rt.pid}</dd>
      <dt>Memory</dt><dd>${rt.memory_mb} MB</dd>
      <dt>Auth</dt><dd>${esc(caps.auth.mode)}</dd>
      <dt>Commands</dt><dd>${Object.entries(rt.commands).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}</dd>`;
    $("#authPill").textContent = caps.auth.required ? "remote (token)" : "local";
    const list = $("#auditList"); list.innerHTML = "";
    if (!audit.records.length) { list.innerHTML = `<div class="empty"><b>No records</b></div>`; }
    for (const r of audit.records) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(r.action)}${r.target ? " · " + esc(r.target) : ""}</div><div class="sub">${esc(r.actor)} · ${fmtTime(r.at)} · ${esc(r.result)}</div></div>`;
      list.appendChild(li);
    }
  } catch {}
}

/* --------------------------------------------------------- approvals */
async function pollApprovals() {
  try {
    const { pending } = await api("/api/approvals");
    State.approvals = pending;
    const badge = $("#approvalCount");
    badge.classList.toggle("hidden", pending.length === 0);
    badge.textContent = pending.length;
    const list = $("#approvalsList"); list.innerHTML = "";
    if (!pending.length) { list.innerHTML = `<div class="empty"><b>No pending approvals</b></div>`; return; }
    for (const a of pending) {
      const li = el("div", "list-item");
      li.innerHTML = `<div class="grow"><div class="nm">${esc(a.summary)}</div><div class="sub">${esc(a.kind)} · ${fmtTime(a.created_at)}</div></div>`;
      const yes = el("button", "btn sm primary"); yes.textContent = "Approve";
      yes.addEventListener("click", async () => { await api(`/api/approvals/${a.id}/decision`, { method: "POST", body: { approved: true } }); toast("Approved", "ok"); pollApprovals(); });
      const no = el("button", "btn sm danger"); no.textContent = "Deny";
      no.addEventListener("click", async () => { await api(`/api/approvals/${a.id}/decision`, { method: "POST", body: { approved: false } }); pollApprovals(); });
      li.append(yes, no); list.appendChild(li);
    }
  } catch {}
}

/* ------------------------------------------------------- command palette */
function buildPalette(query) {
  const q = query.toLowerCase();
  const cmds = [
    { label: "Run agent", sub: "console", run: () => { showView("console"); $("#prompt").focus(); } },
    { label: "Open diff", sub: "review", run: captureDiff },
    { label: "Open terminal", sub: "commands", run: () => showView("terminal") },
    { label: "Open tasks", sub: "board", run: () => { showView("tasks"); refreshTasks(); } },
    { label: "Detect agents", sub: "runtime", run: loadAgents },
    { label: "Refresh files", sub: "workspace", run: loadTree },
    { label: "Toggle theme", sub: "appearance", run: toggleTheme },
    { label: "Save file", sub: "editor", run: saveFile },
    ...Object.keys({ activity: 1, approvals: 1, subagents: 1, tools: 1, mcp: 1, skills: 1, usage: 1, prompt: 1, system: 1 }).map((v) => ({ label: `Panel: ${v}`, sub: "panel", run: () => selectPanel(v) }))
  ].filter((c) => !q || c.label.toLowerCase().includes(q));
  const files = State.files.filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 30).map((f) => ({ label: f.path, sub: "file", run: () => openFile(f.path) }));
  State.paletteItems = [...cmds, ...files];
  const list = $("#paletteList"); list.innerHTML = "";
  State.paletteItems.forEach((item, i) => {
    const row = el("div", `palette-item${i === State.paletteIndex ? " active" : ""}`);
    row.innerHTML = `<span class="pi-ico">${item.sub === "file" ? "·" : "⌘"}</span><span>${esc(item.label)}</span><span class="pi-sub">${esc(item.sub)}</span>`;
    row.addEventListener("click", () => { closePalette(); item.run(); });
    list.appendChild(row);
  });
}
function openPalette() { $("#paletteOverlay").hidden = false; $("#paletteInput").value = ""; State.paletteIndex = 0; buildPalette(""); $("#paletteInput").focus(); }
function closePalette() { $("#paletteOverlay").hidden = true; }
function paletteKey(e) {
  if (e.key === "Escape") return closePalette();
  if (e.key === "ArrowDown") { State.paletteIndex = Math.min(State.paletteIndex + 1, State.paletteItems.length - 1); buildPalette($("#paletteInput").value); e.preventDefault(); }
  if (e.key === "ArrowUp") { State.paletteIndex = Math.max(State.paletteIndex - 1, 0); buildPalette($("#paletteInput").value); e.preventDefault(); }
  if (e.key === "Enter") { const item = State.paletteItems[State.paletteIndex]; if (item) { closePalette(); item.run(); } }
}

/* ----------------------------------------------------------- panel tabs */
function selectPanel(view) {
  $$("#panelTabs .ptab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".panel-view").forEach((v) => { v.hidden = v.dataset.view !== view; });
  if (view === "approvals") pollApprovals();
  if (view === "usage") refreshUsage();
  if (view === "subagents") loadSubagents();
  if (view === "tools") loadTools();
  if (view === "mcp") loadMcp();
  if (view === "skills") loadSkills();
  if (view === "system") loadSystem();
  if (view === "activity") { /* timeline already live */ }
}

/* ------------------------------------------------------------- theme */
function toggleTheme() {
  State.theme = State.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = State.theme;
  localStorage.setItem("tiki-theme", State.theme);
}

/* ------------------------------------------------------------ resizers */
function initResizers() {
  const app = $("#app");
  const setup = (handle, prop, min, max) => {
    handle.addEventListener("mousedown", (e) => {
      handle.classList.add("dragging");
      const startX = e.clientX;
      const start = parseInt(getComputedStyle(document.documentElement).getPropertyValue(prop));
      const move = (ev) => {
        const delta = prop === "--rail-w" ? ev.clientX - startX : startX - ev.clientX;
        const value = Math.min(max, Math.max(min, start + delta));
        document.documentElement.style.setProperty(prop, value + "px");
      };
      const up = () => { handle.classList.remove("dragging"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    });
  };
  setup($("#railResizer"), "--rail-w", 180, 480);
  setup($("#panelResizer"), "--panel-w", 280, 720);
  $("#collapseRail").addEventListener("click", () => { app.classList.toggle("rail-collapsed"); $("#openRail").classList.toggle("hidden", !app.classList.contains("rail-collapsed")); });
  $("#openRail").addEventListener("click", () => { app.classList.remove("rail-collapsed"); $("#openRail").classList.add("hidden"); });
  $("#openPanel").addEventListener("click", () => app.classList.toggle("panel-collapsed"));
}

/* ------------------------------------------------------------- events */
function bindEvents() {
  $("#refreshTree").addEventListener("click", loadTree);
  $("#fileFilter").addEventListener("input", renderTree);
  $("#detectBtn").addEventListener("click", loadAgents);
  $("#detectBtn2").addEventListener("click", loadAgents);
  $("#sendPrompt").addEventListener("click", runAgent);
  $("#prompt").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runAgent(); });
  $("#saveFile").addEventListener("click", saveFile);
  $("#editor").addEventListener("input", () => { State.dirty.set(State.activeTab, true); updateGutter(); updateDirty(); });
  $("#editor").addEventListener("scroll", () => { $("#gutter").scrollTop = $("#editor").scrollTop; });
  $("#editor").addEventListener("click", updateCursor); $("#editor").addEventListener("keyup", updateCursor);
  $("#runCmd").addEventListener("click", runCommand);
  $("#clearTerm").addEventListener("click", () => { $("#terminal").textContent = ""; });
  $("#refreshRuns").addEventListener("click", refreshRuns);
  $("#refreshApprovals").addEventListener("click", pollApprovals);
  $("#refreshMcp").addEventListener("click", loadMcp);
  $("#refreshSkills")?.addEventListener("click", loadSkills);
  $("#refreshUsage").addEventListener("click", refreshUsage);
  $("#refreshSystem").addEventListener("click", loadSystem);
  $("#addTask").addEventListener("click", addTask);
  $("#addSubagent").addEventListener("click", addSubagent);
  $("#addMcp").addEventListener("click", addMcp);
  $("#invokeTool").addEventListener("click", invokeTool);
  $("#savePrompt").addEventListener("click", async () => { try { await api("/api/system-prompt", { method: "PUT", body: { customInstructions: $("#customPrompt").value } }); toast("Instructions saved", "ok"); loadPrompt(); } catch (e) { toast(e.message, "err"); } });
  $("#customPrompt").addEventListener("input", () => { $("#promptChars").textContent = `${$("#customPrompt").value.length} / 30,000`; });
  $("#saveMarkup").addEventListener("click", async () => { try { await api("/api/prices/markup", { method: "POST", body: { markup: Number($("#markupInput").value) } }); toast("Markup saved", "ok"); refreshUsage(); } catch (e) { toast(e.message, "err"); } });
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#paletteBtn").addEventListener("click", openPalette);
  $("#paletteInput").addEventListener("input", () => { State.paletteIndex = 0; buildPalette($("#paletteInput").value); });
  $("#paletteInput").addEventListener("keydown", paletteKey);
  $("#paletteOverlay").addEventListener("click", (e) => { if (e.target.id === "paletteOverlay") closePalette(); });
  $("#activityFilter").addEventListener("change", () => { const f = $("#activityFilter").value; $$("#timeline .ev").forEach((r) => { r.style.display = !f || r.dataset.kind === f ? "" : "none"; }); });
  $("#clearActivity").addEventListener("click", () => { $("#timeline").innerHTML = `<div class="empty"><div class="ei">⌁</div><b>Cleared</b></div>`; });
  $$("#panelTabs .ptab").forEach((t) => t.addEventListener("click", () => selectPanel(t.dataset.view)));
  $("#newFileBtn").addEventListener("click", async () => {
    const p = prompt("New file path (relative to workspace):");
    if (!p) return;
    try { await api("/api/file", { method: "POST", body: { path: p, content: "", create: true } }); toast(`Created ${p}`, "ok"); loadTree(); openFile(p); }
    catch (e) { toast(e.message, "err"); }
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); $("#collapseRail").click(); }
    else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); }
    else if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); showView("terminal"); }
    else if (e.key === "Escape") closePalette();
  });
}
function updateCursor() {
  const ta = $("#editor"); const upto = ta.value.slice(0, ta.selectionStart);
  const line = (upto.match(/\n/g)?.length || 0) + 1;
  const col = upto.length - upto.lastIndexOf("\n");
  $("#editorCursor").textContent = `Ln ${line}, Col ${col}`;
}

/* --------------------------------------------------------------- init */
async function init() {
  document.documentElement.dataset.theme = State.theme;
  bindEvents(); initResizers(); selectPanel("activity");
  connectStream();
  await Promise.allSettled([loadTree(), loadAgents(), loadCommands(), loadTools(), loadMcp(), loadSkills(), refreshRuns(), refreshTasks(), loadPrompt(), refreshUsage(), loadSubagents()]);
  pollApprovals();
  setInterval(pollApprovals, 5000);
  setInterval(refreshTasks, 4000);
  setInterval(refreshRuns, 8000);
  showView("console");
}
document.addEventListener("DOMContentLoaded", init);
