// src/skills/manager.mjs
// Tracks which built-in skills the user has installed. Installation here is a
// record + surfaced command: the IDE never runs the installer itself.
import { listSkillCatalog, getSkill } from "./catalog.mjs";

export function createSkillManager({ store }) {
  const docName = "skills";
  const doc = () => store.load(docName, { version: 1, skills: [] });
  const persist = (d) => store.save(docName, d);

  function listSkills() { return doc().skills; }

  function listBuiltins() {
    const installed = new Set(doc().skills.map((s) => s.id));
    return listSkillCatalog().map((e) => ({ ...e, kind: "skill", installed: installed.has(e.id) }));
  }

  function getInstalled(id) { return doc().skills.find((s) => s.id === id) || null; }

  function installSkill(id, options = {}) {
    const entry = getSkill(id);
    if (!entry) throw new Error(`Unknown built-in skill: ${id}`);
    const d = doc();
    const existing = d.skills.find((s) => s.id === entry.id);
    if (existing) return existing;
    const record = {
      id: entry.id,
      name: entry.name,
      installCommand: entry.install,
      docs: entry.docs || null,
      notes: options.notes ? String(options.notes).slice(0, 500) : null,
      installed_at: new Date().toISOString()
    };
    d.skills.push(record);
    persist(d);
    return record;
  }

  function removeSkill(id) {
    const d = doc();
    const next = d.skills.filter((s) => s.id !== id);
    if (next.length === d.skills.length) throw new Error("Skill not found");
    d.skills = next;
    persist(d);
    return listSkills();
  }

  return { listSkills, listBuiltins, getInstalled, installSkill, removeSkill };
}
