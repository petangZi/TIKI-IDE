// tests/unit/skills.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../../src/storage/store.mjs";
import { createSkillManager } from "../../src/skills/manager.mjs";
import { SKILL_CATALOG, getSkill, listSkillCatalog } from "../../src/skills/catalog.mjs";

const EXPECTED = ["ponytail", "caveman", "openspec"];

async function withManager(fn) {
  const dir = await mkdtemp(join(tmpdir(), "tiki-skill-"));
  try {
    const store = createStore({ dataDir: dir });
    return await fn(createSkillManager({ store }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("skill catalog ships the three requested skills", () => {
  const ids = SKILL_CATALOG.map((s) => s.id);
  for (const id of EXPECTED) assert.ok(ids.includes(id), `missing skill: ${id}`);
  for (const skill of listSkillCatalog()) {
    assert.equal(typeof skill.name, "string");
    assert.ok(skill.install.length > 0, `${skill.id} needs an install command`);
    assert.ok(skill.docs.startsWith("https://"));
  }
});

test("getSkill is case-insensitive", () => {
  assert.equal(getSkill("PONYTAIL").id, "ponytail");
  assert.equal(getSkill("nope"), null);
});

test("install records the command and is idempotent", async () => {
  await withManager((skills) => {
    const rec = skills.installSkill("caveman");
    assert.equal(rec.id, "caveman");
    assert.equal(rec.installCommand, "npx @caveman-ai/cli@latest");
    const again = skills.installSkill("caveman");
    assert.equal(again.id, "caveman");
    assert.equal(skills.listSkills().length, 1);
  });
});

test("builtins report installed state", async () => {
  await withManager((skills) => {
    assert.equal(skills.listBuiltins().every((s) => s.installed === false), true);
    skills.installSkill("openspec");
    const listed = skills.listBuiltins();
    assert.equal(listed.find((s) => s.id === "openspec").installed, true);
    assert.equal(listed.find((s) => s.id === "ponytail").installed, false);
    assert.equal(listed.find((s) => s.id === "openspec").kind, "skill");
  });
});

test("remove deletes and unknown ids fail", async () => {
  await withManager((skills) => {
    skills.installSkill("ponytail");
    const rest = skills.removeSkill("ponytail");
    assert.deepEqual(rest, []);
    assert.throws(() => skills.removeSkill("ponytail"), /not found/);
    assert.throws(() => skills.installSkill("ghost"), /Unknown built-in skill/);
  });
});
