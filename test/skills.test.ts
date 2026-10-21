import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadSkills } from "../src/skills.js";

describe("loadSkills", () => {
  test("loads every skill folder with frontmatter and all files", () => {
    const skills = loadSkills("test/fixtures/skills");
    expect(skills.map((s) => s.name)).toEqual(["auto-skill", "manual-skill"]);
    expect(skills[1].manualOnly).toBe(true);
    expect(skills[0].manualOnly).toBe(false);
    expect(Object.keys(skills[1].files).sort()).toEqual(["SKILL.md", "references/notes.md"]);
  });

  test("fails fast naming the folder when frontmatter is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "broken"));
    writeFileSync(join(tmp, "broken", "SKILL.md"), "# no frontmatter\n");
    expect(() => loadSkills(tmp)).toThrow(/broken/);
  });

  test("fails fast naming the folder when frontmatter has no name", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "nameless"));
    writeFileSync(join(tmp, "nameless", "SKILL.md"), "---\ndescription: x\n---\n");
    expect(() => loadSkills(tmp)).toThrow(/nameless/);
  });

  test("fails fast naming the folder when frontmatter is invalid YAML", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "malformed"));
    writeFileSync(join(tmp, "malformed", "SKILL.md"), "---\nname: [unclosed\n---\n");
    expect(() => loadSkills(tmp)).toThrow(/malformed/);
  });

  test("fails fast naming the folder when name differs from the folder", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "folder-name"));
    writeFileSync(join(tmp, "folder-name", "SKILL.md"), "---\nname: other-name\ndescription: x\n---\n");
    expect(() => loadSkills(tmp)).toThrow(/folder-name/);
  });

  test.each(["../escape", "Upper", "has space", "dot.name"])("fails fast naming the folder for unsafe name %j", (name) => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "unsafe"));
    writeFileSync(join(tmp, "unsafe", "SKILL.md"), `---\nname: "${name}"\ndescription: x\n---\n`);
    expect(() => loadSkills(tmp)).toThrow(/unsafe/);
  });

  test("an unsafe name matching its folder still fails", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-"));
    mkdirSync(join(tmp, "Upper_Case"));
    writeFileSync(join(tmp, "Upper_Case", "SKILL.md"), "---\nname: Upper_Case\ndescription: x\n---\n");
    expect(() => loadSkills(tmp)).toThrow(/Upper_Case/);
  });

  test("loads the real bundled skills", () => {
    expect(loadSkills("skills").map((s) => s.name)).toEqual([
      "calibrate", "merge-prs", "open-pr", "slice-commits",
    ]);
  });
});
