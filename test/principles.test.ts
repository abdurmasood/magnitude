import { describe, expect, test } from "vitest";
import { firstClaudeInstruction, legacySkillMatches, principleDestinations, upsertPrinciples } from "../src/principles.js";
import type { Roots } from "../src/types.js";

const roots: Roots = { project: "/p", home: "/h" };

const START = "<!-- magnitude:coding-principles -->";
const END = "<!-- /magnitude:coding-principles -->";
const block = (body: string) => `${START}\n${body.replace(/\s+$/, "")}\n${END}\n`;

describe("upsertPrinciples", () => {
  test("a missing file becomes only the block", () => {
    expect(upsertPrinciples(undefined, "Rule\n")).toEqual({ status: "new", text: block("Rule") });
  });

  test("appends under existing text with one blank line", () => {
    expect(upsertPrinciples("# Project\n", "Rule\n")).toEqual({
      status: "new",
      text: `# Project\n\n${block("Rule")}`,
    });
  });

  test("an identical block is left untouched, including its original line endings", () => {
    const existing = `${START}\r\nRule\r\n${END}\r\n`;
    expect(upsertPrinciples(existing, "Rule\n")).toEqual({ status: "identical", text: existing });
  });

  test("a different block is swapped and the surrounding text stays", () => {
    const existing = `# Keep\n\n${START}\nold\n${END}\n\n# Also keep\n`;
    const result = upsertPrinciples(existing, "new body");
    expect(result.status).toBe("conflict");
    expect(result.text).toBe(`# Keep\n\n${block("new body")}\n# Also keep\n`);
  });
});

describe("principleDestinations", () => {
  test("project scope always writes AGENTS.md and adds a Claude file only when Claude is selected and one exists", () => {
    expect(principleDestinations(["cursor"], "project", roots, "/p/CLAUDE.md")).toEqual([{ dest: "/p/AGENTS.md" }]);
    expect(principleDestinations(["claude", "cursor"], "project", roots, undefined)).toEqual([{ dest: "/p/AGENTS.md" }]);
    expect(principleDestinations(["claude", "cursor"], "project", roots, "/p/CLAUDE.md")).toEqual([
      { dest: "/p/AGENTS.md" },
      { dest: "/p/CLAUDE.md" },
    ]);
  });

  test("global scope writes a home file per agent that has one, and nothing for Cursor alone", () => {
    expect(principleDestinations(["cursor"], "global", roots, undefined)).toEqual([]);
    expect(principleDestinations(["claude", "codex", "cursor"], "global", roots, undefined)).toEqual([
      { dest: "/h/.claude/CLAUDE.md" },
      { dest: "/h/.codex/AGENTS.md" },
    ]);
  });
});

describe("firstClaudeInstruction", () => {
  test("prefers CLAUDE.md, then .claude/CLAUDE.md, then CLAUDE.local.md", () => {
    const present = new Set(["/p/CLAUDE.md", "/p/.claude/CLAUDE.md", "/p/CLAUDE.local.md"]);
    expect(firstClaudeInstruction("/p", (path) => present.has(path))).toBe("/p/CLAUDE.md");
    present.delete("/p/CLAUDE.md");
    expect(firstClaudeInstruction("/p", (path) => present.has(path))).toBe("/p/.claude/CLAUDE.md");
    present.delete("/p/.claude/CLAUDE.md");
    expect(firstClaudeInstruction("/p", (path) => present.has(path))).toBe("/p/CLAUDE.local.md");
    present.delete("/p/CLAUDE.local.md");
    expect(firstClaudeInstruction("/p", (path) => present.has(path))).toBeUndefined();
  });
});

describe("legacySkillMatches", () => {
  const legacy = { "SKILL.md": "name: coding-principles\n" };

  test("matches the same files, ignoring line endings", () => {
    expect(legacySkillMatches({ "SKILL.md": "name: coding-principles\r\n" }, legacy)).toBe(true);
  });

  test("an edited or extra file does not match", () => {
    expect(legacySkillMatches({ "SKILL.md": "edited\n" }, legacy)).toBe(false);
    expect(legacySkillMatches({ "SKILL.md": "name: coding-principles\n", "extra.md": "x" }, legacy)).toBe(false);
  });
});
