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

  test("loads the real bundled skills", () => {
    expect(loadSkills("skills").map((s) => s.name)).toEqual([
      "calibrate", "coding-principles", "merge-prs", "open-pr", "slice-commits",
    ]);
  });
});
