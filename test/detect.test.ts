import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectAgents, findProjectRoot, scanPresence, scanSkills } from "../src/detect.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "detect-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  test("finds the nearest ancestor containing .git from a nested dir", () => {
    mkdirSync(join(tmp, ".git"));
    const nested = join(tmp, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(tmp);
  });

  test("treats .git as a file (worktree) as a root marker", () => {
    writeFileSync(join(tmp, ".git"), "gitdir: /elsewhere\n");
    const nested = join(tmp, "src");
    mkdirSync(nested);
    expect(findProjectRoot(nested)).toBe(tmp);
  });

  test("falls back to cwd when no .git exists anywhere up the tree", () => {
    const nested = join(tmp, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(nested);
  });
});

describe("detectAgents", () => {
  test("returns [] when nothing is detected", () => {
    expect(detectAgents(tmp)).toEqual([]);
  });

  test.each([
    [".claude", "dir", ["claude"]],
    [".cursor", "dir", ["cursor"]],
    [".agents", "dir", ["codex"]],
    [".codex", "dir", ["codex"]],
    ["AGENTS.md", "file", ["codex"]],
  ])("%s (%s) maps to %j", (name, kind, expected) => {
    if (kind === "dir") mkdirSync(join(tmp, name));
    else writeFileSync(join(tmp, name), "# agents\n");
    expect(detectAgents(tmp)).toEqual(expected);
  });

  test("ignores wrong entry types", () => {
    writeFileSync(join(tmp, ".claude"), "x");
    mkdirSync(join(tmp, "AGENTS.md"));
    expect(detectAgents(tmp)).toEqual([]);
  });

  test("rethrows errors other than a missing entry", () => {
    const locked = join(tmp, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(() => detectAgents(locked)).toThrow(/EACCES/);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test("reports codex once and orders claude, cursor, codex", () => {
    mkdirSync(join(tmp, ".agents"));
    writeFileSync(join(tmp, "AGENTS.md"), "x");
    mkdirSync(join(tmp, ".cursor"));
    mkdirSync(join(tmp, ".claude"));
    expect(detectAgents(tmp)).toEqual(["claude", "cursor", "codex"]);
  });
});

describe("scanSkills", () => {
  test("reads only the named skills, with nested files under posix keys", () => {
    const folder = join(tmp, ".claude", "skills");
    mkdirSync(join(folder, "alpha", "references"), { recursive: true });
    writeFileSync(join(folder, "alpha", "SKILL.md"), "A");
    writeFileSync(join(folder, "alpha", "references", "n.md"), "N");
    mkdirSync(join(folder, "stray"));
    writeFileSync(join(folder, "stray", "other.md"), "x");
    expect(scanSkills([folder], ["alpha", "absent"])).toEqual({
      [folder]: { alpha: { "SKILL.md": "A", "references/n.md": "N" } },
    });
  });

  test("ignores an unreadable unrelated skill", () => {
    const folder = join(tmp, "skills");
    mkdirSync(join(folder, "mine"), { recursive: true });
    writeFileSync(join(folder, "mine", "secret"), "s");
    chmodSync(join(folder, "mine", "secret"), 0o000);
    mkdirSync(join(folder, "alpha"));
    writeFileSync(join(folder, "alpha", "SKILL.md"), "A");
    expect(scanSkills([folder], ["alpha"])).toEqual({ [folder]: { alpha: { "SKILL.md": "A" } } });
  });

  test("fails naming the path when a chosen skill has an unreadable file", () => {
    const folder = join(tmp, "skills");
    mkdirSync(join(folder, "alpha"), { recursive: true });
    const secret = join(folder, "alpha", "secret");
    writeFileSync(secret, "s");
    chmodSync(secret, 0o000);
    expect(() => scanSkills([folder], ["alpha"])).toThrow(secret);
  });

  test("records a plain file at a skill name as present and empty", () => {
    const folder = join(tmp, "skills");
    mkdirSync(folder);
    writeFileSync(join(folder, "alpha"), "not a folder");
    expect(scanSkills([folder], ["alpha"])).toEqual({ [folder]: { alpha: {} } });
  });

  test("scans a symlinked skill folder with its files", () => {
    const folder = join(tmp, "skills");
    const target = join(tmp, "real");
    mkdirSync(folder);
    mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), "S");
    symlinkSync(target, join(folder, "linked"));
    expect(scanSkills([folder], ["linked"])).toEqual({ [folder]: { linked: { "SKILL.md": "S" } } });
  });

  test("records a broken-symlink skill folder as present and empty", () => {
    const folder = join(tmp, "skills");
    mkdirSync(folder);
    symlinkSync(join(tmp, "nowhere"), join(folder, "dangling"));
    expect(scanSkills([folder], ["dangling"])).toEqual({ [folder]: { dangling: {} } });
  });

  test("scans a skill containing a symlinked subdir and a broken link without throwing", () => {
    const folder = join(tmp, "skills");
    const extra = join(tmp, "extra");
    mkdirSync(join(folder, "s"), { recursive: true });
    mkdirSync(extra);
    writeFileSync(join(extra, "e.md"), "E");
    writeFileSync(join(folder, "s", "SKILL.md"), "S");
    symlinkSync(extra, join(folder, "s", "ref"));
    symlinkSync(join(tmp, "nowhere"), join(folder, "s", "broken"));
    expect(scanSkills([folder], ["s"])).toEqual({
      [folder]: { s: { "SKILL.md": "S", "ref/e.md": "E" } },
    });
  });

  test("omits missing folders and maps an existing folder without the skills to {}", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    const missing = join(tmp, "missing");
    expect(scanSkills([empty, missing], ["alpha"])).toEqual({ [empty]: {} });
  });
});

describe("scanPresence", () => {
  test("records named entries of any type as {} without reading them", () => {
    const folder = join(tmp, "skills");
    mkdirSync(join(folder, "alpha"), { recursive: true });
    writeFileSync(join(folder, "alpha", "secret"), "s");
    chmodSync(join(folder, "alpha", "secret"), 0o000);
    writeFileSync(join(folder, "beta"), "file");
    symlinkSync(join(tmp, "nowhere"), join(folder, "gamma"));
    mkdirSync(join(folder, "unrelated"));
    const missing = join(tmp, "missing");
    expect(scanPresence([folder, missing], ["alpha", "beta", "gamma", "delta"])).toEqual({
      [folder]: { alpha: {}, beta: {}, gamma: {} },
    });
  });
});
