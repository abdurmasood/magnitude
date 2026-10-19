import { describe, expect, test } from "vitest";
import { buildPlan, expectedFiles, folderPath, foldersReadBy, resolveWrites } from "../src/plan.js";
import type { Plan, Roots, Scan, Skill } from "../src/types.js";

const roots: Roots = { project: "/p", home: "/h" };
const auto: Skill = { name: "auto-skill", description: "d", manualOnly: false, files: { "SKILL.md": "line1\nline2\n" } };
const manual: Skill = {
  name: "manual-skill",
  description: "d",
  manualOnly: true,
  files: { "SKILL.md": "m\n", "references/notes.md": "n\n" },
};
const skills = [auto, manual];

describe("folderPath / foldersReadBy", () => {
  test("folderPath picks the root by scope", () => {
    expect(folderPath(".claude/skills", "project", roots)).toBe("/p/.claude/skills");
    expect(folderPath(".agents/skills", "global", roots)).toBe("/h/.agents/skills");
  });

  test("foldersReadBy lists project then home folders per agent", () => {
    expect(foldersReadBy("claude", roots)).toEqual(["/p/.claude/skills", "/h/.claude/skills"]);
    expect(foldersReadBy("codex", roots)).toEqual(["/p/.agents/skills", "/h/.agents/skills"]);
    expect(foldersReadBy("cursor", roots)).toEqual([
      "/p/.claude/skills",
      "/p/.agents/skills",
      "/p/.cursor/skills",
      "/h/.claude/skills",
      "/h/.agents/skills",
      "/h/.cursor/skills",
    ]);
  });
});

describe("buildPlan statuses", () => {
  test("new skill when the target is empty", () => {
    const plan = buildPlan({ agents: ["claude"], scope: "project", skills: ["auto-skill"] }, skills, roots, {});
    expect(plan.writes).toEqual([
      expect.objectContaining({ dest: "/p/.claude/skills/auto-skill", status: "new", readers: ["claude"] }),
    ]);
    expect(plan.writes[0].files).toEqual(auto.files);
  });

  test("identical existing folder is skipped silently, line endings ignored", () => {
    const scan: Scan = { "/p/.claude/skills": { "auto-skill": { "SKILL.md": "line1\r\nline2\r\n" } } };
    const plan = buildPlan({ agents: ["claude"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.writes[0].status).toBe("identical");
  });

  test("an existing .agents copy compares against ours including openai.yaml", () => {
    const scan: Scan = {
      "/p/.agents/skills": { "manual-skill": expectedFiles(manual, ".agents/skills") },
    };
    const plan = buildPlan({ agents: ["codex"], scope: "project", skills: ["manual-skill"] }, skills, roots, scan);
    expect(plan.writes[0].status).toBe("identical");
    expect(plan.writes[0].files["agents/openai.yaml"]).toBeDefined();
  });

  test("different content is a conflict", () => {
    const scan: Scan = { "/p/.claude/skills": { "auto-skill": { "SKILL.md": "other" } } };
    const plan = buildPlan({ agents: ["claude"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.writes[0].status).toBe("conflict");
  });

  test("same content but an extra file is a conflict", () => {
    const scan: Scan = { "/p/.claude/skills": { "auto-skill": { "SKILL.md": "line1\nline2\n", "extra.md": "x" } } };
    const plan = buildPlan({ agents: ["claude"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.writes[0].status).toBe("conflict");
  });

  test("global scope uses home", () => {
    const plan = buildPlan({ agents: ["codex"], scope: "global", skills: ["auto-skill"] }, skills, roots, {});
    expect(plan.writes[0].dest).toBe("/h/.agents/skills/auto-skill");
  });

  test("writes are ordered by target folder then chosen skill order", () => {
    const plan = buildPlan(
      { agents: ["claude", "codex"], scope: "project", skills: ["manual-skill", "auto-skill"] },
      skills,
      roots,
      {},
    );
    expect(plan.writes.map((w) => w.dest)).toEqual([
      "/p/.claude/skills/manual-skill",
      "/p/.claude/skills/auto-skill",
      "/p/.agents/skills/manual-skill",
      "/p/.agents/skills/auto-skill",
    ]);
  });
});

describe("buildPlan warnings", () => {
  test("warns about same-name skills in folders a ticked agent reads but we don't write", () => {
    const scan: Scan = { "/p/.agents/skills": { "auto-skill": { "SKILL.md": "x" } } };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([{ skill: "auto-skill", folder: "/p/.agents/skills", agents: ["cursor"] }]);
  });

  test("warns about .cursor/skills and the global copy of a project install", () => {
    const scan: Scan = {
      "/p/.cursor/skills": { "auto-skill": { "SKILL.md": "x" } },
      "/h/.claude/skills": { "auto-skill": { "SKILL.md": "y" } },
    };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([
      { skill: "auto-skill", folder: "/h/.claude/skills", agents: ["claude", "cursor"] },
      { skill: "auto-skill", folder: "/p/.cursor/skills", agents: ["cursor"] },
    ]);
  });

  test("never warns about skills that were not chosen or about target folders", () => {
    const scan: Scan = {
      "/p/.claude/skills": { "auto-skill": { "SKILL.md": "x" } },
      "/p/.agents/skills": { "manual-skill": { "SKILL.md": "x" } },
    };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([]);
  });

  test("project and home being the same folder yields no duplicate or self warnings", () => {
    const same: Roots = { project: "/h", home: "/h" };
    const scan: Scan = {
      "/h/.claude/skills": { "auto-skill": { "SKILL.md": "x" } },
      "/h/.cursor/skills": { "auto-skill": { "SKILL.md": "x" } },
    };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["auto-skill"] }, skills, same, scan);
    expect(plan.warnings).toEqual([{ skill: "auto-skill", folder: "/h/.cursor/skills", agents: ["cursor"] }]);
  });
});

describe("resolveWrites", () => {
  const scan: Scan = {
    "/p/.claude/skills": { "auto-skill": { "SKILL.md": "different" } },
    "/p/.agents/skills": { "manual-skill": expectedFiles(manual, ".agents/skills") },
  };
  const plan: Plan = buildPlan(
    { agents: ["claude", "codex"], scope: "project", skills: ["auto-skill", "manual-skill"] },
    skills,
    roots,
    scan,
  );
  // statuses: claude/auto conflict, claude/manual new, codex/auto new, codex/manual identical

  test("new -> create, conflict+replace -> replace, identical omitted", () => {
    const out = resolveWrites(plan, { "/p/.claude/skills/auto-skill": "replace" });
    expect(out).toEqual([
      { dest: "/p/.claude/skills/auto-skill", files: auto.files, mode: "replace" },
      { dest: "/p/.claude/skills/manual-skill", files: expectedFiles(manual, ".claude/skills"), mode: "create" },
      { dest: "/p/.agents/skills/auto-skill", files: auto.files, mode: "create" },
    ]);
  });

  test("conflict+keep is omitted", () => {
    const out = resolveWrites(plan, { "/p/.claude/skills/auto-skill": "keep" });
    expect(out.map((w) => w.dest)).not.toContain("/p/.claude/skills/auto-skill");
    expect(out).toHaveLength(2);
  });

  test("an undecided conflict defaults to keep", () => {
    const out = resolveWrites(plan, {});
    expect(out.map((w) => w.dest)).not.toContain("/p/.claude/skills/auto-skill");
    expect(out.every((w) => w.mode === "create")).toBe(true);
  });
});
