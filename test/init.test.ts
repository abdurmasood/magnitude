import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { runInit, type InitOptions } from "../src/init.js";
import { CODEX_MANUAL_YAML } from "../src/plan.js";

const skillsDir = resolve("test/fixtures/skills");
const temp = (label: string) => mkdtempSync(join(tmpdir(), `magnitude-init-${label}-`));

let cwd: string;
let home: string;
let lines: string[];
let errors: string[];
let base: InitOptions;

beforeEach(() => {
  cwd = temp("cwd");
  home = temp("home");
  mkdirSync(join(cwd, ".git"));
  lines = [];
  errors = [];
  base = {
    argv: [], cwd, home, skillsDir, interactive: false,
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
});

/** Every file under root, posix-relative and sorted, ignoring agent marker folders without files. */
function tree(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return files.sort();
}

const exists = (root: string, path: string) => existsSync(join(root, path));

test("--yes with detected Claude + Cursor writes only .claude/skills", async () => {
  mkdirSync(join(cwd, ".claude"));
  mkdirSync(join(cwd, ".cursor"));
  expect(await runInit({ ...base, argv: ["init", "--yes"] })).toBe(0);
  expect(tree(cwd)).toEqual([
    ".claude/skills/auto-skill/SKILL.md",
    ".claude/skills/manual-skill/SKILL.md",
    ".claude/skills/manual-skill/references/notes.md",
  ]);
  expect(exists(cwd, ".cursor/skills")).toBe(false);
  expect(lines).toContain("Claude Code / Cursor: /auto-skill");
});

test("Codex writes openai.yaml for manual-only skills", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "codex"] })).toBe(0);
  expect(tree(cwd)).toEqual([
    ".agents/skills/auto-skill/SKILL.md",
    ".agents/skills/manual-skill/SKILL.md",
    ".agents/skills/manual-skill/agents/openai.yaml",
    ".agents/skills/manual-skill/references/notes.md",
  ]);
  expect(readFileSync(join(cwd, ".agents/skills/manual-skill/agents/openai.yaml"), "utf8")).toBe(CODEX_MANUAL_YAML);
  expect(lines).toContain("Codex: $auto-skill");
});

test("--global writes under home, not cwd", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--global"] })).toBe(0);
  expect(tree(home)).toEqual([
    ".claude/skills/auto-skill/SKILL.md",
    ".claude/skills/manual-skill/SKILL.md",
    ".claude/skills/manual-skill/references/notes.md",
  ]);
  expect(exists(cwd, ".claude")).toBe(false);
});

test("an existing different skill is kept by default with --yes, replaced with --replace", async () => {
  const mine = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(mine, "mine");
  const argv = ["init", "--yes", "--agents", "claude", "--skills", "auto-skill"];

  expect(await runInit({ ...base, argv })).toBe(0);
  expect(readFileSync(mine, "utf8")).toBe("mine");
  expect(lines).toContain("Nothing to write. Kept 1 existing skill(s).");

  expect(await runInit({ ...base, argv: [...argv, "--replace"] })).toBe(0);
  expect(readFileSync(mine, "utf8")).toContain("name: auto-skill");
});

test("a kept conflict alongside a new skill still writes the new one", async () => {
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "mine");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--keep-existing"] })).toBe(0);
  expect(readFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "utf8")).toBe("mine");
  expect(exists(cwd, ".claude/skills/manual-skill/SKILL.md")).toBe(true);
});

test("second run prints 'Everything is already up to date.' and writes nothing", async () => {
  const argv = ["init", "--yes", "--agents", "claude"];
  expect(await runInit({ ...base, argv })).toBe(0);
  const skillMd = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  const before = statSync(skillMd).mtimeMs;
  lines = [];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(lines).toEqual(["Everything is already up to date."]);
  expect(statSync(skillMd).mtimeMs).toBe(before);
});

test("warns when a chosen skill already exists in another folder a ticked agent reads", async () => {
  mkdirSync(join(cwd, ".agents/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/auto-skill/SKILL.md"), "other");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude,cursor"] })).toBe(0);
  expect(lines).toContain("Cursor will also load .agents/skills/auto-skill");
  expect(readFileSync(join(cwd, ".agents/skills/auto-skill/SKILL.md"), "utf8")).toBe("other");
});

test("non-interactive without --yes returns 1 and writes nothing", async () => {
  mkdirSync(join(cwd, ".claude"));
  expect(await runInit({ ...base, argv: ["init"] })).toBe(1);
  expect(lines).toEqual([]);
  expect(errors).toEqual(["Not a terminal. Re-run with --yes (and --agents) to install without questions."]);
  expect(exists(cwd, ".claude/skills")).toBe(false);
});

test("no agents detected and no --agents returns 2", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes"] })).toBe(2);
  expect(errors).toEqual(["No agents detected. Pass --agents claude,cursor,codex (any of them)."]);
  expect(tree(cwd)).toEqual([]);
});

test("an unknown skill name returns 2 with the valid names", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--skills", "nope"] })).toBe(2);
  expect(errors).toEqual(["Unknown skill: nope. Valid skills: auto-skill, manual-skill"]);
});

test("--help prints usage and returns 0 even without a terminal", async () => {
  expect(await runInit({ ...base, argv: ["--help"] })).toBe(0);
  expect(lines.join("\n")).toContain("magnitude init [--agents claude,cursor,codex]");
});

test("--version prints the package.json version and returns 0", async () => {
  const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
  expect(await runInit({ ...base, argv: ["--version"] })).toBe(0);
  expect(lines).toEqual([version]);
});
