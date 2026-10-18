// src/skills/catalog.mjs
// Curated catalog of built-in agent skills. Skills are not MCP servers: they
// shape how the agent works (output style, code discipline, spec workflow) and
// ship as plugins / hooks / CLI integrations. Installing one records the intent
// and surfaces the exact command to run — nothing is executed automatically.

export const SKILL_CATALOG = [
  {
    id: "ponytail",
    name: "Ponytail",
    description:
      "Lazy-senior-dev mode: says nothing, writes one line, and still ships tests for risky logic. Cuts code, time, cost and tokens. Ships as an opencode plugin plus skills and hooks for 20+ agents.",
    install: "npx @dietrichgebert/ponytail",
    docs: "https://github.com/dietrichgebert/ponytail",
    homepage: "ponytail.dev",
    requires: ["npx"],
    tags: ["code-quality", "minimalism", "plugin"]
  },
  {
    id: "caveman",
    name: "Caveman",
    description:
      "Ultra-compressed communication mode: fewer input and output tokens, same answers, code unchanged. Installs skills and hooks across 30+ agents.",
    install: "npx @caveman-ai/cli@latest",
    docs: "https://github.com/JuliusBrussee/caveman",
    requires: ["npx"],
    tags: ["tokens", "compression", "output-style"]
  },
  {
    id: "openspec",
    name: "OpenSpec",
    description:
      "Spec-driven development workflow: `/opsx:explore`, `/opsx:propose`, `/opsx:verify` and friends, backed by a project-local spec store. `openspec init` wires the slash commands into your tools.",
    install: "npm install -g @fission-ai/openspec@latest && openspec init",
    docs: "https://github.com/Fission-AI/openspec",
    requires: ["node >=20.19"],
    tags: ["spec", "planning", "workflow", "cli"]
  }
];

export function getSkill(id) {
  const key = String(id || "").toLowerCase();
  return SKILL_CATALOG.find((e) => e.id.toLowerCase() === key) || null;
}

export function listSkillCatalog() {
  return SKILL_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    install: e.install,
    docs: e.docs || null,
    homepage: e.homepage || null,
    requires: e.requires || [],
    tags: e.tags || []
  }));
}
