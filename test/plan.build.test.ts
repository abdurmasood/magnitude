import { describe, expect, test } from "vitest";
import { upsertPrinciples } from "../src/principles.js";
import { buildPlan, expectedFiles, folderPath, foldersReadBy, resolveInstructions, resolveWrites, type PrinciplesContext } from "../src/plan.js";
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
  test("warns about a different same-name skill in a folder a ticked agent reads but we don't write", () => {
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
      { skill: "auto-skill", folder: "/p/.cursor/skills", agents: ["cursor"] },
      { skill: "auto-skill", folder: "/h/.claude/skills", agents: ["claude", "cursor"] },
    ]);
  });

  test("an identical copy gives no warning, line endings ignored", () => {
    const scan: Scan = {
      "/p/.agents/skills": { "auto-skill": { "SKILL.md": "line1\r\nline2\r\n" } },
      "/h/.cursor/skills": { "auto-skill": auto.files },
    };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([]);
  });

  test("a manual-only .agents/skills copy with openai.yaml gives no warning", () => {
    const scan: Scan = { "/p/.agents/skills": { "manual-skill": expectedFiles(manual, ".agents/skills") } };
    const plan = buildPlan({ agents: ["claude", "cursor"], scope: "project", skills: ["manual-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([]);
  });

  test("never warns about folders no ticked agent reads", () => {
    const scan: Scan = { "/p/.cursor/skills": { "auto-skill": { "SKILL.md": "x" } } };
    const plan = buildPlan({ agents: ["claude"], scope: "project", skills: ["auto-skill"] }, skills, roots, scan);
    expect(plan.warnings).toEqual([]);
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

describe("buildPlan principles", () => {
  const body = "Rule\n";
  const context = (files: Record<string, string>, legacySkills: PrinciplesContext["legacySkills"] = {}): PrinciplesContext => ({
    body,
    bodyFile: "/pkg/coding-principles.md",
    files,
    legacy: { "SKILL.md": "shipped\n" },
    legacySkills,
  });

  test("a missing AGENTS.md is new", () => {
    const plan = buildPlan({ agents: ["cursor"], scope: "project", skills: [] }, skills, roots, {}, context({}));
    expect(plan.instructions).toEqual([{ dest: "/p/AGENTS.md", status: "new", text: upsertPrinciples(undefined, body).text }]);
  });

  test("existing text is kept and the block is appended", () => {
    const plan = buildPlan({ agents: ["cursor"], scope: "project", skills: [] }, skills, roots, {}, context({ "/p/AGENTS.md": "# Mine\n" }));
    expect(plan.instructions[0].status).toBe("new");
    expect(plan.instructions[0].text.startsWith("# Mine\n\n")).toBe(true);
  });

  test("an identical block is skipped", () => {
    const text = upsertPrinciples(undefined, body).text;
    const plan = buildPlan({ agents: ["cursor"], scope: "project", skills: [] }, skills, roots, {}, context({ "/p/AGENTS.md": text }));
    expect(plan.instructions[0].status).toBe("identical");
  });

  test("a different block is a conflict and the replacement keeps surrounding text", () => {
    const existing = upsertPrinciples("# Mine\n", "old\n").text;
    const plan = buildPlan({ agents: ["cursor"], scope: "project", skills: [] }, skills, roots, {}, context({ "/p/AGENTS.md": existing }));
    expect(plan.instructions[0].status).toBe("conflict");
    expect(plan.instructions[0].text.startsWith("# Mine\n\n")).toBe(true);
    expect(plan.instructions[0].text).toContain("Rule");
    expect(plan.instructions[0].text).not.toContain("old");
  });

  test("global Cursor points the note at the bundled file and writes no principles file", () => {
    const plan = buildPlan({ agents: ["cursor"], scope: "global", skills: ["auto-skill"] }, skills, roots, {}, context({}));
    expect(plan.cursorPrinciplesSource).toBe("/pkg/coding-principles.md");
    expect(plan.kept).toEqual([]);
    expect(plan.instructions).toEqual([]);
    expect(plan.writes[0].dest).toBe("/h/.agents/skills/auto-skill");
  });

  test("global Claude and Cursor point the note at ~/.claude/CLAUDE.md; project scope has no note", () => {
    const global = buildPlan({ agents: ["claude", "cursor"], scope: "global", skills: [] }, skills, roots, {}, context({}));
    expect(global.cursorPrinciplesSource).toBe("/h/.claude/CLAUDE.md");
    const project = buildPlan({ agents: ["cursor"], scope: "project", skills: [] }, skills, roots, {}, context({}));
    expect(project.cursorPrinciplesSource).toBeUndefined();
  });

  test("an identical old skill is removed and an edited one is reported", () => {
    const dest = "/p/.claude/skills/coding-principles";
    const same = buildPlan({ agents: ["claude"], scope: "project", skills: [] }, skills, roots, {}, context({}, { [dest]: { "SKILL.md": "shipped\n" } }));
    expect(same.removals).toEqual([{ dest }]);
    const edited = buildPlan({ agents: ["claude"], scope: "project", skills: [] }, skills, roots, {}, context({}, { [dest]: { "SKILL.md": "mine\n" } }));
    expect(edited.removals).toEqual([]);
    expect(edited.kept).toEqual([dest]);
  });
});

describe("resolveInstructions", () => {
  const plan: Plan = {
    writes: [],
    warnings: [],
    kept: [],
    removals: [],
    instructions: [
      { dest: "/p/AGENTS.md", status: "new", text: "new" },
      { dest: "/p/CLAUDE.md", status: "conflict", text: "replaced" },
      { dest: "/p/skip.md", status: "identical", text: "same" },
    ],
  };

  test("new is written, a replaced conflict is written, identical and kept conflicts are not", () => {
    expect(resolveInstructions(plan, { "/p/CLAUDE.md": "replace" })).toEqual([
      { dest: "/p/AGENTS.md", text: "new" },
      { dest: "/p/CLAUDE.md", text: "replaced" },
    ]);
    expect(resolveInstructions(plan, { "/p/CLAUDE.md": "keep" })).toEqual([{ dest: "/p/AGENTS.md", text: "new" }]);
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
