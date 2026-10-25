import { describe, expect, test } from "vitest";
import { CODEX_MANUAL_YAML, expectedFiles, readersOf, targetFolders } from "../src/install/plan.js";
import type { AgentId, FolderKey, Skill } from "../src/install/types.js";

const RULE: [AgentId[], FolderKey[]][] = [
  [["claude"], [".claude/skills"]],
  [["cursor"], [".agents/skills"]],
  [["codex"], [".agents/skills"]],
  [["claude", "cursor"], [".claude/skills"]],
  [["cursor", "codex"], [".agents/skills"]],
  [["claude", "codex"], [".claude/skills", ".agents/skills"]],
  [["claude", "cursor", "codex"], [".claude/skills", ".agents/skills"]],
];

const auto: Skill = { name: "auto-skill", description: "d", manualOnly: false, files: { "SKILL.md": "a" } };
const manual: Skill = { name: "manual-skill", description: "d", manualOnly: true, files: { "SKILL.md": "m" } };

describe("targetFolders", () => {
  test.each(RULE)("%j writes %j", (agents, folders) => {
    expect(targetFolders(agents)).toEqual(folders);
  });

  test("order of ticked agents doesn't matter", () => {
    expect(targetFolders(["codex", "claude"])).toEqual([".claude/skills", ".agents/skills"]);
  });

  test("never targets .cursor/skills", () => {
    for (const [agents] of RULE) expect(targetFolders(agents)).not.toContain(".cursor/skills");
  });
});

describe("readersOf", () => {
  test("filters to ticked agents in claude, cursor, codex order", () => {
    expect(readersOf(".claude/skills", ["claude", "cursor"])).toEqual(["claude", "cursor"]);
    expect(readersOf(".agents/skills", ["cursor", "codex"])).toEqual(["cursor", "codex"]);
    expect(readersOf(".agents/skills", ["codex", "cursor", "claude"])).toEqual(["cursor", "codex"]);
    expect(readersOf(".claude/skills", ["codex"])).toEqual([]);
  });
});

describe("expectedFiles", () => {
  test("manual-only skill gets openai.yaml only under .agents/skills", () => {
    expect(expectedFiles(manual, ".agents/skills")["agents/openai.yaml"]).toBe(CODEX_MANUAL_YAML);
    expect(expectedFiles(manual, ".claude/skills")["agents/openai.yaml"]).toBeUndefined();
    expect(expectedFiles(auto, ".agents/skills")["agents/openai.yaml"]).toBeUndefined();
  });

  test("does not mutate skill.files", () => {
    expectedFiles(manual, ".agents/skills");
    expect(manual.files).toEqual({ "SKILL.md": "m" });
  });

  test("CODEX_MANUAL_YAML is the exact policy", () => {
    expect(CODEX_MANUAL_YAML).toBe("policy:\n  allow_implicit_invocation: false\n");
  });
});
