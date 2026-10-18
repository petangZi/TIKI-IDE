// src/api/routes/skills.mjs
// Built-in agent skills: catalog, install (records intent), remove.
export function registerSkillRoutes(router, services) {
  const { skills, audit } = services;

  router.get("/api/skills", () => ({ skills: skills.listSkills() }));
  router.get("/api/skills/builtins", () => ({ builtins: skills.listBuiltins() }));
  router.post("/api/skills/builtins/:id/install", async (ctx) => {
    let body = {};
    try { body = (await ctx.readBody()) || {}; } catch { body = {}; }
    const skill = skills.installSkill(ctx.params.id, body);
    audit?.record?.({ actor: "user", action: "skill.install", target: skill.name });
    return { __status: 201, body: { skill, skills: skills.listSkills() } };
  });
  router.delete("/api/skills/:id", (ctx) => ({ skills: skills.removeSkill(ctx.params.id) }));
}
