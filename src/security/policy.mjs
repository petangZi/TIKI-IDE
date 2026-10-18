// src/security/policy.mjs
// Server-side policy engine: command risk classification, per-request approval
// decisions, and resource limits. UI confirmation is never the security boundary.
const RISK = {
  read: "low",
  write: "medium",
  execute: "high",
  network: "medium",
  destructive: "critical"
};

// Allowlisted developer commands. Each entry declares argv (no shell), a risk
// level, and whether approval is required. Keys are exact request identifiers.
const COMMANDS = {
  "git status": { argv: ["git", ["status", "--short"]], risk: RISK.read, approval: false },
  "git diff stat": { argv: ["git", ["diff", "--stat"]], risk: RISK.read, approval: false },
  "git diff": { argv: ["git", ["diff"]], risk: RISK.read, approval: false },
  "git log": { argv: ["git", ["log", "--oneline", "-20"]], risk: RISK.read, approval: false },
  "git branch": { argv: ["git", ["branch", "--show-current"]], risk: RISK.read, approval: false },
  "node version": { argv: ["node", ["--version"]], risk: RISK.read, approval: false },
  "npm run build": { argv: ["npm", ["run", "build"]], risk: RISK.execute, approval: true },
  "npm test": { argv: ["npm", ["test"]], risk: RISK.execute, approval: true },
  "npm run lint": { argv: ["npm", ["run", "lint"]], risk: RISK.execute, approval: true },
  "python3 version": { argv: ["python3", ["--version"]], risk: RISK.read, approval: false }
};

const DANGEROUS_HINTS = [
  /\brm\s+-rf\b/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\bshutdown\b/i, /\breboot\b/i,
  /:\(\)\s*\{/, /\bcurl\b.*\|\s*(sh|bash)/i, /\bchmod\s+777\b/i, /\bgit\s+push\b/i
];

export function createPolicy({ workspace = null, config = {} } = {}) {
  const approvals = new Map(); // id -> pending approval

  function classifyCommand(commandId) {
    const entry = COMMANDS[commandId];
    if (entry) return { allowed: true, ...entry, command: commandId };
    return { allowed: false, command: commandId, risk: "unknown", reason: "Command not in allowlist" };
  }

  function listCommands() {
    return Object.entries(COMMANDS).map(([id, v]) => ({ id, risk: v.risk, approval: v.approval }));
  }

  function inspectText(text) {
    const flags = DANGEROUS_HINTS.filter((re) => re.test(String(text))).map((re) => re.source);
    return { dangerous: flags.length > 0, flags };
  }

  /** Create a pending approval request. Resolves when approved/denied/expired. */
  function requestApproval({ kind, summary, detail = {}, runId = null, timeoutMs = 120_000 }) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        approvals.delete(id);
        resolve({ id, approved: false, reason: "expired" });
      }, timeoutMs);
      approvals.set(id, {
        id, kind, summary, detail, run_id: runId,
        created_at: new Date().toISOString(),
        resolve: (decision) => { clearTimeout(timer); approvals.delete(id); resolve({ id, ...decision }); }
      });
    });
  }

  function decide(id, approved, reason = null) {
    const item = approvals.get(id);
    if (!item) return false;
    item.resolve({ approved: !!approved, reason });
    return true;
  }

  function pending() {
    return [...approvals.values()].map(({ resolve, ...rest }) => rest);
  }

  function capabilities() {
    return {
      commands: listCommands(),
      approvalRequired: Object.values(COMMANDS).filter((c) => c.approval).length,
      workspaceRoot: workspace?.root || config.workspace || null,
      riskLevels: RISK
    };
  }

  return { classifyCommand, listCommands, inspectText, requestApproval, decide, pending, capabilities, RISK };
}
