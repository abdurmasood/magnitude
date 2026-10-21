import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { stripVTControlCharacters as plain } from "node:util";
import {
  applyFileWrites,
  applyRemovals,
  applyWrites,
  displayPath,
  finishedLines,
  nextStepLines,
  nextSteps,
  reviewEntries,
  reviewLines,
} from "../src/write.js";
import type { FinalWrite, Plan, Roots, SkillWrite } from "../src/types.js";

const temp = () => mkdtempSync(join(tmpdir(), "magnitude-write-"));

describe("applyWrites", () => {
  test("creates missing parent folders, including a fresh global home", () => {
    const home = join(temp(), "fresh-home");
    const dest = join(home, ".claude", "skills", "calibrate");
    applyWrites([{ dest, files: { "SKILL.md": "a", "references/notes.md": "b" }, mode: "create" }]);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("a");
    expect(readFileSync(join(dest, "references", "notes.md"), "utf8")).toBe("b");
  });

  test("replace removes stale files", () => {
    const dest = join(temp(), "skill");
    mkdirSync(dest);
    writeFileSync(join(dest, "old.md"), "old");
    applyWrites([{ dest, files: { "SKILL.md": "x" }, mode: "replace" }]);
    expect(existsSync(join(dest, "old.md"))).toBe(false);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("x");
  });

  test("replace on a symlinked dest removes the link, not the target's contents", () => {
    const root = temp();
    const target = join(root, "target");
    mkdirSync(target);
    writeFileSync(join(target, "keep.md"), "keep");
    const dest = join(root, "link");
    symlinkSync(target, dest);
    applyWrites([{ dest, files: { "SKILL.md": "x" }, mode: "replace" }]);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("x");
    expect(existsSync(join(target, "SKILL.md"))).toBe(false);
    expect(readFileSync(join(target, "keep.md"), "utf8")).toBe("keep");
  });

  test("replace on a broken symlink dest creates a real directory", () => {
    const root = temp();
    const dest = join(root, "link");
    symlinkSync(join(root, "missing"), dest);
    applyWrites([{ dest, files: { "SKILL.md": "x" }, mode: "replace" }]);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("x");
  });
});

describe("nextStepLines", () => {
  test("next step uses / for Claude and Cursor, $ for Codex, calibrate first", () => {
    expect(nextStepLines(["claude", "codex"], ["open-pr", "calibrate"])).toEqual(["Claude Code: /calibrate", "Codex: $calibrate"]);
  });
  test("Claude and Cursor share one line", () =>
    expect(nextStepLines(["claude", "cursor"], ["calibrate"])).toEqual(["Claude Code / Cursor: /calibrate"]));
  test("falls back to the first chosen skill without calibrate", () =>
    expect(nextStepLines(["cursor"], ["open-pr"])).toEqual(["Cursor: /open-pr"]));
  test("Codex alone uses $", () => expect(nextStepLines(["codex"], ["open-pr"])).toEqual(["Codex: $open-pr"]));
  test("all three agents", () =>
    expect(nextStepLines(["claude", "cursor", "codex"], ["calibrate"])).toEqual(["Claude Code / Cursor: /calibrate", "Codex: $calibrate"]));
});

describe("nextSteps", () => {
  test("groups the slash agents and lists Codex apart", () =>
    expect(nextSteps(["claude", "cursor", "codex"], ["open-pr", "calibrate"])).toEqual([
      { command: "/calibrate", agents: ["claude", "cursor"] },
      { command: "$calibrate", agents: ["codex"] },
    ]));
  test("Codex alone has one step", () => expect(nextSteps(["codex"], ["open-pr"])).toEqual([{ command: "$open-pr", agents: ["codex"] }]));
});

describe("finishedLines", () => {
  test("shows every step done, the file count, the next commands and the docs", () => {
    expect(finishedLines(12, ["claude", "cursor", "codex"], ["calibrate"]).map((line) => plain(line))).toEqual([
      "▁▃▅▇ magnitude   skills for Claude Code, Cursor and Codex",
      "",
      "✓ agents ── ✓ location ── ✓ skills ── ✓ review",
      "",
      "Wrote 12 files.",
      "",
      "Next  /calibrate  in Claude Code / Cursor",
      "      $calibrate  in Codex",
      "Docs  github.com/abdurmasood/magnitude",
    ]);
  });
  test("spells one file and leads with Codex when it is the only agent", () => {
    const lines = finishedLines(1, ["codex"], ["open-pr"]).map((line) => plain(line));
    expect(lines[4]).toBe("Wrote 1 file.");
    expect(lines.slice(6)).toEqual(["Next  $open-pr  in Codex", "Docs  github.com/abdurmasood/magnitude"]);
  });
});

describe("reviewLines", () => {
  const roots: Roots = { project: "/work/app", home: "/home/me" };
  const sw = (skill: string, folder: string, readers: SkillWrite["readers"]): SkillWrite => ({
    skill, folder, dest: `${folder}/${skill}`, files: {}, status: "new", readers,
  });
  const plan: Plan = {
    warnings: [],
    instructions: [],
    removals: [],
    notes: [],
    writes: [
      sw("a", "/home/me/.claude/skills", ["claude", "cursor"]),
      sw("b", "/home/me/.claude/skills", ["claude", "cursor"]),
      sw("a", "/home/me/.agents/skills", ["cursor", "codex"]),
      sw("c", "/work/app/.agents/skills", ["codex"]),
    ],
  };
  const final = (dest: string, n: number): FinalWrite => ({
    dest, mode: "create", files: Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.md`, "x"])),
  });

  test("review shows ~ for home and the total file count", () => {
    const writes = [final("/home/me/.claude/skills/a", 2), final("/home/me/.claude/skills/b", 1), final("/home/me/.agents/skills/a", 3)];
    expect(reviewLines(plan, writes, roots)).toEqual([
      "~/.claude/skills: 2 skills, read by Claude Code, Cursor",
      "~/.agents/skills: 1 skill, read by Cursor, Codex",
      "6 files total",
    ]);
  });

  test("skips folders with no final write and shows project folders relative to the project", () => {
    const writes = [final("/work/app/.agents/skills/c", 1)];
    expect(reviewLines(plan, writes, roots)).toEqual([".agents/skills: 1 skill, read by Codex", "1 file total"]);
  });

  test("lists coding principles files and skill removals", () => {
    const withRemoval: Plan = { ...plan, removals: [{ dest: "/work/app/.claude/skills/coding-principles" }] };
    expect(reviewLines(withRemoval, [], roots, [{ dest: "/work/app/AGENTS.md" }], withRemoval.removals)).toEqual([
      "AGENTS.md: coding principles",
      "remove .claude/skills/coding-principles",
      "1 file total",
    ]);
  });
});

describe("reviewEntries", () => {
  const roots: Roots = { project: "/work/app", home: "/home/me" };
  const plan: Plan = {
    warnings: [],
    instructions: [],
    removals: [{ dest: "/work/app/.claude/skills/coding-principles" }],
    notes: [],
    writes: [{ skill: "a", folder: "/work/app/.claude/skills", dest: "/work/app/.claude/skills/a", files: {}, status: "new", readers: ["claude"] }],
  };

  test("returns folders, principles files and removals with the file count", () => {
    const writes: FinalWrite[] = [{ dest: "/work/app/.claude/skills/a", mode: "create", files: { "SKILL.md": "x", "b.md": "y" } }];
    expect(reviewEntries(plan, writes, roots, [{ dest: "/work/app/AGENTS.md" }], plan.removals)).toEqual({
      entries: [
        { path: ".claude/skills", detail: "1 skill, read by Claude Code", removal: false },
        { path: "AGENTS.md", detail: "coding principles", removal: false },
        { path: ".claude/skills/coding-principles", detail: "remove", removal: true },
      ],
      fileCount: 3,
    });
  });
});

describe("applyFileWrites / applyRemovals", () => {
  test("writes the file, creates missing parents, and leaves sibling files", () => {
    const dir = temp();
    writeFileSync(join(dir, "other.md"), "stay");
    const dest = join(dir, "nested", "AGENTS.md");
    applyFileWrites([{ dest, text: "principles\n" }]);
    expect(readFileSync(dest, "utf8")).toBe("principles\n");
    expect(readFileSync(join(dir, "other.md"), "utf8")).toBe("stay");
  });

  test("removes a skill directory", () => {
    const dest = join(temp(), "coding-principles");
    mkdirSync(dest);
    writeFileSync(join(dest, "SKILL.md"), "x");
    applyRemovals([dest]);
    expect(existsSync(dest)).toBe(false);
  });

  test("removes a symlinked skill directory without deleting the target", () => {
    const root = temp();
    const target = join(root, "target");
    mkdirSync(target);
    writeFileSync(join(target, "keep.md"), "keep");
    const dest = join(root, "link");
    symlinkSync(target, dest);
    applyRemovals([dest]);
    expect(existsSync(dest)).toBe(false);
    expect(readFileSync(join(target, "keep.md"), "utf8")).toBe("keep");
  });
});

describe("displayPath", () => {
  const roots: Roots = { project: "/work/app", home: "/home/me" };
  test("project paths are relative, home paths use ~", () => {
    expect(displayPath("/work/app/.claude/skills/a", roots)).toBe(".claude/skills/a");
    expect(displayPath("/home/me/.claude/skills/a", roots)).toBe("~/.claude/skills/a");
  });
  test("does not mangle sibling prefixes like /home/me2", () => {
    expect(displayPath("/home/me2/x", roots)).toBe("/home/me2/x");
    expect(displayPath("/work/application/x", roots)).toBe("/work/application/x");
  });
});
