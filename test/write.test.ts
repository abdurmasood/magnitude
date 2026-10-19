import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyWrites, nextStepLines, reviewLines } from "../src/write.js";
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

describe("reviewLines", () => {
  const roots: Roots = { project: "/work/app", home: "/home/me" };
  const sw = (skill: string, folder: string, readers: SkillWrite["readers"]): SkillWrite => ({
    skill, folder, dest: `${folder}/${skill}`, files: {}, status: "new", readers,
  });
  const plan: Plan = {
    warnings: [],
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

  test("skips folders with no final write and does not mangle /home2", () => {
    const writes = [final("/work/app/.agents/skills/c", 1)];
    expect(reviewLines(plan, writes, { project: "/work/app", home: "/work" })).toEqual([
      "~/app/.agents/skills: 1 skill, read by Codex",
      "1 file total",
    ]);
    expect(reviewLines(plan, writes, { project: "/work/app", home: "/wor" })[0]).toBe("/work/app/.agents/skills: 1 skill, read by Codex");
  });
});
