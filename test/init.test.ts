import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { runInit, type InitOptions } from "../src/init.js";
import { readLedger } from "../src/ledger.js";
import { CODEX_MANUAL_YAML } from "../src/plan.js";
import { loadPrinciplesBody, upsertPrinciples } from "../src/principles.js";

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
    "AGENTS.md",
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
    "AGENTS.md",
  ]);
  expect(readFileSync(join(cwd, ".agents/skills/manual-skill/agents/openai.yaml"), "utf8")).toBe(CODEX_MANUAL_YAML);
  expect(lines).toContain("Codex: $auto-skill");
});

test("--global writes under home, not cwd", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--global"] })).toBe(0);
  expect(tree(home)).toEqual([
    ".claude/CLAUDE.md",
    ".claude/skills/auto-skill/SKILL.md",
    ".claude/skills/manual-skill/SKILL.md",
    ".claude/skills/manual-skill/references/notes.md",
    ".magnitude/installs.json",
  ]);
  expect(exists(cwd, ".claude")).toBe(false);
  expect(exists(cwd, "AGENTS.md")).toBe(false);
  expect(readLedger(home).installs[0]?.root).toBe(home);
});

test("init records selected skills and a later init keeps the earlier ones", async () => {
  const argv = ["init", "--yes", "--agents", "claude"];
  expect(await runInit({ ...base, argv: [...argv, "--skills", "auto-skill"] })).toBe(0);
  expect(await runInit({ ...base, argv: [...argv, "--skills", "manual-skill"] })).toBe(0);
  expect(readLedger(home)).toEqual({
    installs: [{
      root: cwd,
      skills: [
        { name: "auto-skill", dest: join(cwd, ".claude/skills/auto-skill") },
        { name: "manual-skill", dest: join(cwd, ".claude/skills/manual-skill") },
      ],
    }],
  });
});

test("a kept skill is still recorded", async () => {
  const dest = join(cwd, ".claude/skills/auto-skill");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), "mine");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--skills", "auto-skill"] })).toBe(0);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("mine");
  expect(readLedger(home).installs).toEqual([{ root: cwd, skills: [{ name: "auto-skill", dest }] }]);
});

test("an existing different skill is kept by default with --yes, replaced with --replace", async () => {
  const mine = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(mine, "mine");
  const argv = ["init", "--yes", "--agents", "claude", "--skills", "auto-skill"];

  expect(await runInit({ ...base, argv })).toBe(0);
  expect(readFileSync(mine, "utf8")).toBe("mine");
  expect(lines).toEqual([
    "Kept .claude/skills/auto-skill (differs from ours; use --replace to overwrite)",
    "AGENTS.md: coding principles",
    "1 file total",
    "Claude Code: /auto-skill",
  ]);

  expect(await runInit({ ...base, argv: [...argv, "--replace"] })).toBe(0);
  expect(readFileSync(mine, "utf8")).toContain("name: auto-skill");
});

test("a kept conflict alongside a new skill still writes the new one", async () => {
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "mine");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--keep-existing"] })).toBe(0);
  expect(readFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "utf8")).toBe("mine");
  expect(exists(cwd, ".claude/skills/manual-skill/SKILL.md")).toBe(true);
  expect(lines[0]).toBe("Kept .claude/skills/auto-skill (differs from ours; use --replace to overwrite)");
});

test("a kept global conflict is reported with ~", async () => {
  mkdirSync(join(home, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(join(home, ".claude/skills/auto-skill/SKILL.md"), "mine");
  const argv = ["init", "--yes", "--agents", "claude", "--global", "--skills", "auto-skill"];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(lines[0]).toBe("Kept ~/.claude/skills/auto-skill (differs from ours; use --replace to overwrite)");
});

test("unreadable unrelated skills in the target folder and in home do not affect init", async () => {
  const lock = (path: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "secret");
    chmodSync(path, 0o000);
  };
  lock(join(cwd, ".claude/skills/mine/secret"));
  lock(join(home, ".claude/skills/mine/secret"));
  lock(join(home, ".agents/skills/mine/secret"));
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude,cursor"] })).toBe(0);
  expect(exists(cwd, ".claude/skills/auto-skill/SKILL.md")).toBe(true);
  expect(errors).toEqual([]);
});

test("an unreadable file inside a chosen skill in the target folder fails naming the path", async () => {
  const secret = join(cwd, ".claude/skills/auto-skill/secret");
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(secret, "s");
  chmodSync(secret, 0o000);
  await expect(runInit({ ...base, argv: ["init", "--yes", "--agents", "claude"] })).rejects.toThrow(secret);
  expect(exists(cwd, ".claude/skills/manual-skill")).toBe(false);
});

test("a plain file at a skill name is a conflict: kept by default, replaced with --replace", async () => {
  const path = join(cwd, ".claude/skills/manual-skill");
  mkdirSync(join(cwd, ".claude/skills"), { recursive: true });
  writeFileSync(path, "a file");
  const argv = ["init", "--yes", "--agents", "claude", "--skills", "manual-skill"];

  expect(await runInit({ ...base, argv })).toBe(0);
  expect(readFileSync(path, "utf8")).toBe("a file");
  expect(lines).toEqual([
    "Kept .claude/skills/manual-skill (differs from ours; use --replace to overwrite)",
    "AGENTS.md: coding principles",
    "1 file total",
    "Claude Code: /manual-skill",
  ]);

  expect(await runInit({ ...base, argv: [...argv, "--replace"] })).toBe(0);
  expect(tree(join(cwd, ".claude/skills"))).toEqual(["manual-skill/SKILL.md", "manual-skill/references/notes.md"]);
});

test("second run prints '✓ Up to date. Nothing to write.' and writes nothing", async () => {
  const argv = ["init", "--yes", "--agents", "claude"];
  expect(await runInit({ ...base, argv })).toBe(0);
  const skillMd = join(cwd, ".claude/skills/auto-skill/SKILL.md");
  const before = statSync(skillMd).mtimeMs;
  lines = [];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(lines).toEqual(["✓ Up to date. Nothing to write."]);
  expect(statSync(skillMd).mtimeMs).toBe(before);
});

test("warns when a chosen skill differs in another folder a ticked agent reads", async () => {
  mkdirSync(join(cwd, ".agents/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/auto-skill/SKILL.md"), "other");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude,cursor"] })).toBe(0);
  expect(lines).toContain("▲ .agents/skills/auto-skill differs from magnitude's. Cursor will load both.");
  expect(readFileSync(join(cwd, ".agents/skills/auto-skill/SKILL.md"), "utf8")).toBe("other");
});

test("an identical copy in another folder a ticked agent reads gives no warning", async () => {
  cpSync(join(skillsDir, "auto-skill"), join(cwd, ".agents/skills/auto-skill"), { recursive: true });
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude,cursor"] })).toBe(0);
  expect(lines.filter((line) => line.includes(".agents/skills/auto-skill"))).toEqual([]);
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
  expect(lines.join("\n")).toContain("magnitude update");
});

test("project scope writes AGENTS.md and does not create CLAUDE.md", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude,cursor"] })).toBe(0);
  expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("# Coding Principles");
  expect(exists(cwd, "CLAUDE.md")).toBe(false);
  expect(exists(cwd, ".claude/CLAUDE.md")).toBe(false);
});

test("an existing CLAUDE.md keeps its text and gains the block, and so does AGENTS.md", async () => {
  writeFileSync(join(cwd, "CLAUDE.md"), "# Mine\n");
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude"] })).toBe(0);
  const claude = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
  expect(claude.startsWith("# Mine\n\n")).toBe(true);
  expect(claude).toContain("<!-- magnitude:coding-principles -->");
  expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain("<!-- magnitude:coding-principles -->");
});

test("an identical principles block is not rewritten", async () => {
  const text = upsertPrinciples(undefined, loadPrinciplesBody()).text;
  writeFileSync(join(cwd, "AGENTS.md"), text);
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "cursor"] })).toBe(0);
  expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toBe(text);
});

test("a different principles block is kept with --yes and replaced without touching the rest", async () => {
  const old = upsertPrinciples("# Stay\n", "old\n").text;
  const path = join(cwd, "AGENTS.md");
  writeFileSync(path, old);
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "cursor"] })).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(old);
  expect(lines).toContain("Kept AGENTS.md (coding principles differ; use --replace to overwrite)");

  lines = [];
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "cursor", "--replace"] })).toBe(0);
  const next = readFileSync(path, "utf8");
  expect(next.startsWith("# Stay\n\n")).toBe(true);
  expect(next).toContain("# Coding Principles");
  expect(next).not.toContain("\nold\n");
});

test("global Claude and Codex write their home files", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--global", "--skills", "auto-skill"] })).toBe(0);
  expect(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8")).toContain("# Coding Principles");
  expect(exists(cwd, "AGENTS.md")).toBe(false);

  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "codex", "--global", "--skills", "auto-skill"] })).toBe(0);
  expect(readFileSync(join(home, ".codex", "AGENTS.md"), "utf8")).toContain("# Coding Principles");
});

test("global Cursor writes no principles file, still installs the skill, and points at the bundled principles", async () => {
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "cursor", "--global", "--skills", "auto-skill"] })).toBe(0);
  expect(exists(home, ".agents/skills/auto-skill/SKILL.md")).toBe(true);
  expect(exists(home, "AGENTS.md")).toBe(false);
  expect(exists(home, ".claude/CLAUDE.md")).toBe(false);
  expect(exists(home, ".codex/AGENTS.md")).toBe(false);
  expect(lines.slice(-4)).toEqual([
    "▲ Cursor won't get the coding principles. It has no global rules file.",
    `  Paste them from ${resolve("instructions/coding-principles.md")} into Cursor Settings › Rules › User Rules.`,
    "",
    "Cursor: /auto-skill",
  ]);
});

test("global Claude and Cursor point the note at ~/.claude/CLAUDE.md and a second run prints only the up-to-date line", async () => {
  const argv = ["init", "--yes", "--agents", "claude,cursor", "--global"];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(lines).toContain("  Paste them from ~/.claude/CLAUDE.md into Cursor Settings › Rules › User Rules.");
  lines = [];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(lines).toEqual(["✓ Up to date. Nothing to write."]);
});

test("an identical old coding-principles skill is removed and an edited one is kept", async () => {
  const legacy = readFileSync(resolve("instructions/legacy/coding-principles/SKILL.md"), "utf8");
  const folder = join(cwd, ".claude/skills/coding-principles");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), legacy);
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "claude", "--skills", "auto-skill"] })).toBe(0);
  expect(existsSync(folder)).toBe(false);
  expect(lines).toContain("remove .claude/skills/coding-principles");

  const edited = join(cwd, ".agents/skills/coding-principles");
  mkdirSync(edited, { recursive: true });
  writeFileSync(join(edited, "SKILL.md"), "edited\n");
  lines = [];
  expect(await runInit({ ...base, argv: ["init", "--yes", "--agents", "codex", "--skills", "auto-skill"] })).toBe(0);
  expect(readFileSync(join(edited, "SKILL.md"), "utf8")).toBe("edited\n");
  expect(lines).toContain("Kept .agents/skills/coding-principles (old coding-principles skill was edited; remove it yourself)");
});

test("--version prints the package.json version and returns 0", async () => {
  const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
  expect(await runInit({ ...base, argv: ["--version"] })).toBe(0);
  expect(lines).toEqual([version]);
});
