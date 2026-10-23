import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { runInit, type InitOptions } from "../src/init.js";
import { recordInstalls } from "../src/ledger.js";
import { CODEX_MANUAL_YAML } from "../src/plan.js";
import { applyRecordedSkills, type UpdateHooks } from "../src/update.js";

const skillsDir = resolve("test/fixtures/skills");
const npmPath = "/usr/local/lib/node_modules/@magnitudeai/cli/dist/cli.js";
const pnpmPath = "/Users/x/Library/pnpm/global/5/node_modules/@magnitudeai/cli/dist/cli.js";
const bunPath = "/Users/x/.bun/install/global/node_modules/@magnitudeai/cli/dist/cli.js";
const npxPath = "/Users/x/.npm/_npx/abc/node_modules/@magnitudeai/cli/dist/cli.js";
const localPath = "/proj/node_modules/@magnitudeai/cli/dist/cli.js";
const sourcePath = "/Users/x/Development/magnitude/src/cli.ts";

const NOT_GLOBAL = "Magnitude is not installed globally. Install it with npm, pnpm, or bun, then run magnitude update.";
const NONE_RECORDED = "No projects are recorded. Run magnitude init in a project to record one.";

let cwd: string;
let home: string;
let lines: string[];
let errors: string[];
let installed: string[][];
let applied: number;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "magnitude-update-cwd-"));
  home = mkdtempSync(join(tmpdir(), "magnitude-update-home-"));
  mkdirSync(join(cwd, ".git"));
  lines = [];
  errors = [];
  installed = [];
  applied = 0;
});

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function hooks(packagePath: string, current: string, latest: string, install?: UpdateHooks["install"]): UpdateHooks {
  return {
    packagePath,
    currentVersion: current,
    latest: async () => latest,
    install: install ?? (async (bin, args) => { installed.push([bin, ...args]); }),
    apply: async () => {
      applied += 1;
      return applyRecordedSkills(home, skillsDir, (line) => lines.push(line));
    },
    hasPackageJson: (dir) => dir === "/proj",
  };
}

function run(update: UpdateHooks): Promise<number> {
  const options: InitOptions = {
    argv: ["update"], cwd, home, skillsDir, interactive: false, update,
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  return runInit(options);
}

test("npm, pnpm, and bun paths choose that package manager", async () => {
  expect(await run(hooks(npmPath, "0.1.0", "0.1.1"))).toBe(0);
  expect(await run(hooks(pnpmPath, "0.1.0", "0.1.1"))).toBe(0);
  expect(await run(hooks(bunPath, "0.1.0", "0.1.1"))).toBe(0);
  expect(installed).toEqual([
    ["npm", "install", "-g", "@magnitudeai/cli@latest"],
    ["pnpm", "add", "-g", "@magnitudeai/cli@latest"],
    ["bun", "add", "-g", "@magnitudeai/cli@latest"],
  ]);
  expect(lines.filter((line) => line === NONE_RECORDED)).toHaveLength(3);
});

test("npx, a project install, and a source checkout stop before installing", async () => {
  write(join(cwd, "AGENTS.md"), "principles");
  for (const packagePath of [npxPath, localPath, sourcePath]) {
    installed = [];
    applied = 0;
    lines = [];
    errors = [];
    expect(await run(hooks(packagePath, "0.1.0", "0.1.1"))).toBe(1);
    expect(installed).toEqual([]);
    expect(applied).toBe(0);
    expect(errors).toEqual([NOT_GLOBAL]);
  }
  expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe("principles");
});

test("the current version stops and leaves recorded skills alone", async () => {
  const skill = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  write(skill, "old");
  recordInstalls(home, cwd, [{ name: "auto-skill", dest: join(cwd, ".claude/skills/auto-skill") }]);
  expect(await run(hooks(npmPath, "0.1.3", "0.1.3"))).toBe(0);
  expect(lines).toEqual(["You are already on the latest version (0.1.3)."]);
  expect(installed).toEqual([]);
  expect(applied).toBe(0);
  expect(readFileSync(skill, "utf8")).toBe("old");
});

test("a failed install does not refresh skills", async () => {
  const skill = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  write(skill, "old");
  recordInstalls(home, cwd, [{ name: "auto-skill", dest: join(cwd, ".claude/skills/auto-skill") }]);
  const update = hooks(npmPath, "0.1.0", "0.1.1", async () => { throw new Error("npm failed"); });
  expect(await run(update)).toBe(1);
  expect(errors).toEqual(["npm failed"]);
  expect(applied).toBe(0);
  expect(readFileSync(skill, "utf8")).toBe("old");
});

test("a newer version replaces recorded skills and leaves everything else", async () => {
  const auto = join(cwd, ".claude/skills/auto-skill");
  const manual = join(cwd, ".agents/skills/manual-skill");
  const gone = join(cwd, ".claude/skills/gone");
  write(join(auto, "SKILL.md"), "old");
  write(join(auto, "keep.txt"), "keep");
  write(join(cwd, ".claude/skills/other/SKILL.md"), "other");
  write(join(cwd, "AGENTS.md"), "principles");
  write(join(manual, "keep.txt"), "keep");
  write(join(gone, "SKILL.md"), "leave");
  recordInstalls(home, cwd, [
    { name: "auto-skill", dest: auto },
    { name: "manual-skill", dest: manual },
    { name: "gone", dest: gone },
    { name: "auto-skill", dest: join(cwd, ".claude/skills/missing") },
  ]);

  expect(await run(hooks(npmPath, "0.1.0", "0.1.1"))).toBe(0);
  expect(installed).toEqual([["npm", "install", "-g", "@magnitudeai/cli@latest"]]);
  expect(readFileSync(join(auto, "SKILL.md"), "utf8")).toBe(readFileSync(join(skillsDir, "auto-skill/SKILL.md"), "utf8"));
  expect(readFileSync(join(auto, "keep.txt"), "utf8")).toBe("keep");
  expect(readFileSync(join(cwd, ".claude/skills/other/SKILL.md"), "utf8")).toBe("other");
  expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe("principles");
  expect(readFileSync(join(manual, "SKILL.md"), "utf8")).toBe(readFileSync(join(skillsDir, "manual-skill/SKILL.md"), "utf8"));
  expect(readFileSync(join(manual, "references/notes.md"), "utf8")).toBe(readFileSync(join(skillsDir, "manual-skill/references/notes.md"), "utf8"));
  expect(readFileSync(join(manual, "agents/openai.yaml"), "utf8")).toBe(CODEX_MANUAL_YAML);
  expect(readFileSync(join(manual, "keep.txt"), "utf8")).toBe("keep");
  expect(readFileSync(join(gone, "SKILL.md"), "utf8")).toBe("leave");
  expect(existsSync(join(cwd, ".claude/skills/missing"))).toBe(false);
  expect(existsSync(join(cwd, ".claude/skills/manual-skill"))).toBe(false);
});
