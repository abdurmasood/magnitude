import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import { beforeEach, expect, test, vi } from "vitest";
import { runInit, type InitOptions } from "../src/init.js";
import { upsertPrinciples } from "../src/principles.js";
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
    log: (line) => lines.push(plain(line)),
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

test("a differing principles block is prompted as an instruction conflict", async () => {
  const dest = join(cwd, "AGENTS.md");
  const old = upsertPrinciples("# Stay\n", "old\n").text;
  writeFileSync(dest, old);
  vi.mocked(askDecisions).mockResolvedValue({ [dest]: "keep" });
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askDecisions).mock.calls[0][0]).toContainEqual({ dest, label: "AGENTS.md", instruction: true });
  expect(readFileSync(dest, "utf8")).toBe(old);
});

test("answering replace replaces the conflicting skill", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValue({ [dest]: "replace" });
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askDecisions).mock.calls[0][0]).toEqual([{ dest, label: ".claude/skills/auto-skill" }]);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toContain("name: auto-skill");
  expect(lines.some((line) => line.startsWith("Kept"))).toBe(false);
});

test("answering keep logs the kept skill and writes the rest", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValue({ [dest]: "keep" });
  expect(await runInit(base)).toBe(0);
  expect(lines).toContain("Kept .claude/skills/auto-skill (differs from ours; use --replace to overwrite)");
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("mine");
  expect(existsSync(join(cwd, ".claude/skills/manual-skill/SKILL.md"))).toBe(true);
});

test("an interactive run ends with the finished screen under the full header", async () => {
  expect(await runInit(base)).toBe(0);
  expect(lines.slice(-8)).toEqual([
    "▁▃▅▇ magnitude   skills for Claude Code, Cursor and Codex",
    "",
    "✓ agents ── ✓ location ── ✓ skills ── ✓ review",
    "",
    "Wrote 4 files.",
    "",
    "Next  /auto-skill  in Claude Code",
    "Docs  github.com/abdurmasood/magnitude",
  ]);
});

test("going back from confirm asks the answers again and does not repeat a warning", async () => {
  mkdirSync(join(cwd, ".agents/skills/auto-skill"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/auto-skill/SKILL.md"), "other");
  const answers = { agents: ["claude", "cursor"] as ["claude", "cursor"], scope: "project" as const, skills: ["auto-skill", "manual-skill"] };
  vi.mocked(askAnswers).mockResolvedValue(answers);
  vi.mocked(askConfirm).mockResolvedValueOnce("back").mockResolvedValueOnce(true);
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askAnswers)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(askAnswers).mock.calls[1][4]).toEqual({ resume: answers });
  expect(vi.mocked(askConfirm)).toHaveBeenCalledTimes(2);
  expect(lines.filter((line) => line.includes("will also load"))).toEqual(["Cursor will also load .agents/skills/auto-skill"]);
  expect(existsSync(join(cwd, ".claude/skills/manual-skill/SKILL.md"))).toBe(true);
});

test("going back from the first conflict asks the answers again", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValueOnce("back").mockResolvedValueOnce({ [dest]: "keep" });
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askAnswers)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(askConfirm)).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("mine");
});

test("going back from confirm returns to the last conflict", async () => {
  ownSkill();
  const dest = join(cwd, ".claude/skills/auto-skill");
  vi.mocked(askDecisions).mockResolvedValueOnce({ [dest]: "keep" }).mockResolvedValueOnce({ [dest]: "replace" });
  vi.mocked(askConfirm).mockResolvedValueOnce("back").mockResolvedValueOnce(true);
  expect(await runInit(base)).toBe(0);
  expect(vi.mocked(askAnswers)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(askDecisions).mock.calls[1][1]).toMatchObject({ startIndex: 0, animate: false, initial: { [dest]: "keep" } });
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toContain("name: auto-skill");
});

test("an interactive run shows the review inside the confirm question instead of logging it", async () => {
  expect(await runInit(base)).toBe(0);
  const [entries, fileCount] = vi.mocked(askConfirm).mock.calls[0];
  expect(entries).toContainEqual({ path: ".claude/skills", detail: "2 skills, read by Claude Code", removal: false });
  expect(fileCount).toBe(4);
  expect(lines.some((line) => line.includes("read by") || line.endsWith("files total"))).toBe(false);
});
