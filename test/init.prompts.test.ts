import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { runInit, type InitOptions } from "../src/init.js";
import { askAnswers, askConfirm, askDecisions } from "../src/prompts.js";

vi.mock("../src/prompts.js", () => ({
  askAnswers: vi.fn(),
  askConfirm: vi.fn(),
  askDecisions: vi.fn(),
}));

const skillsDir = resolve("test/fixtures/skills");
const temp = (label: string) => mkdtempSync(join(tmpdir(), `magnitude-prompts-${label}-`));

let cwd: string;
let home: string;
let lines: string[];
let errors: string[];
let base: InitOptions;

beforeEach(() => {
  vi.resetAllMocks();
  cwd = temp("cwd");
  home = temp("home");
  mkdirSync(join(cwd, ".git"));
  mkdirSync(join(cwd, ".claude"));
  lines = [];
  errors = [];
  base = {
    argv: ["init"], cwd, home, skillsDir, interactive: true,
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  // Echo the preset back as the answers, filling open questions from the defaults.
  vi.mocked(askAnswers).mockImplementation(async (defaults, preset) => ({ ...defaults, ...preset }));
  vi.mocked(askConfirm).mockResolvedValue(true);
});

const ownSkill = () => {
  mkdirSync(join(cwd, ".claude/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "mine");
};

test("no flags leaves every question open with detected defaults", async () => {
  expect(await runInit(base)).toBe(0);
  const [defaults, preset] = vi.mocked(askAnswers).mock.calls[0];
  expect(defaults).toEqual({ agents: ["claude"], scope: "project", skills: ["auto-skill", "manual-skill"] });
  expect(preset).toEqual({});
});

test("--agents, --skills and --global preset those questions", async () => {
  const argv = ["init", "--agents", "codex", "--skills", "manual-skill", "--global"];
  expect(await runInit({ ...base, argv })).toBe(0);
  expect(vi.mocked(askAnswers).mock.calls[0][1]).toEqual({ agents: ["codex"], skills: ["manual-skill"], scope: "global" });
  expect(existsSync(join(home, ".agents/skills/manual-skill/SKILL.md"))).toBe(true);
});

test("--skills all presets every skill", async () => {
  expect(await runInit({ ...base, argv: ["init", "--skills", "all"] })).toBe(0);
  expect(vi.mocked(askAnswers).mock.calls[0][1]).toEqual({ skills: ["auto-skill", "manual-skill"] });
});

test("declining the confirm returns 1 and writes nothing", async () => {
  vi.mocked(askConfirm).mockResolvedValue(false);
  expect(await runInit(base)).toBe(1);
  expect(errors).toEqual(["Cancelled. Nothing was written."]);
  expect(existsSync(join(cwd, ".claude/skills"))).toBe(false);
});

test("cancelling the questions returns 1 and writes nothing", async () => {
  vi.mocked(askAnswers).mockResolvedValue(null);
  expect(await runInit(base)).toBe(1);
  expect(errors).toEqual(["Cancelled. Nothing was written."]);
  expect(existsSync(join(cwd, ".claude/skills"))).toBe(false);
});

test("cancelling a conflict question returns 1 and writes nothing", async () => {
  ownSkill();
  vi.mocked(askDecisions).mockResolvedValue(null);
  expect(await runInit(base)).toBe(1);
  expect(errors).toEqual(["Cancelled. Nothing was written."]);
  expect(readFileSync(join(cwd, ".claude/skills/auto-skill/SKILL.md"), "utf8")).toBe("mine");
  expect(existsSync(join(cwd, ".claude/skills/manual-skill"))).toBe(false);
  expect(askConfirm).not.toHaveBeenCalled();
});

test("answering replace replaces the conflicting skill", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValue({ [dest]: "replace" });
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askDecisions).mock.calls[0][0].map((write) => write.dest)).toEqual([dest]);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toContain("name: auto-skill");
  expect(lines.some((line) => line.startsWith("Kept"))).toBe(false);
});

test("answering keep logs the kept skill and writes the rest", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValue({ [dest]: "keep" });
  expect(await runInit(base)).toBe(0);
  expect(lines[0]).toBe("Kept .claude/skills/auto-skill (differs from ours; use --replace to overwrite)");
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("mine");
  expect(existsSync(join(cwd, ".claude/skills/manual-skill/SKILL.md"))).toBe(true);
});
