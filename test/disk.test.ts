import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyFileWrites, applyRemovals, applyWrites } from "../src/install/disk.js";

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
