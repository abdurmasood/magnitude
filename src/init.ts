import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAgents, findProjectRoot, scanPresence, scanSkills } from "./detect.js";
import { parseFlags, resolveNonInteractive, UsageError, type Flags } from "./flags.js";
import { buildPlan, folderPath, foldersReadBy, resolveWrites, targetFolders } from "./plan.js";
import { askAnswers, askConfirm, askDecisions } from "./prompts.js";
import { loadSkills } from "./skills.js";
import type { AgentId, Answers, Decision, DuplicateWarning, Plan, Roots, Scan, Skill, SkillWrite } from "./types.js";
import { AGENT_NAMES, applyWrites, displayPath, nextStepLines, reviewLines } from "./write.js";

export interface InitOptions {
  argv: string[];
  cwd: string;
  home: string;
  skillsDir: string;
  interactive: boolean;
  log: (line: string) => void;
  /** Usage errors, refusals and cancellation; cli.ts sends these to stderr. */
  error: (line: string) => void;
}

const USAGE = [
  "Usage:",
  "  magnitude init [--agents claude,cursor,codex] [--skills all|name,name]",
  "                 [--global] [--replace | --keep-existing] [--yes]",
  "  magnitude --help | --version",
  "",
  "Options:",
  "  --agents <list>    Agents to install for: claude, cursor, codex (default: detected)",
  "  --skills <list>    Skills to install, or all (default: all)",
  "  --global           Install under your home folder instead of the project",
  "  --replace          Replace existing skills that differ from ours",
  "  --keep-existing    Keep existing skills that differ from ours (default with --yes)",
  "  -y, --yes          Skip every prompt",
  "  -h, --help         Show this help",
  "  -v, --version      Show the version",
];

const NOT_A_TERMINAL = "Not a terminal. Re-run with --yes (and --agents) to install without questions.";

/** Thrown when the user cancels any prompt; unwinds to runInit. */
class Cancelled extends Error {}

const unlessCancelled = <T>(value: T | null): T => {
  if (value === null) throw new Cancelled();
  return value;
};

export async function runInit(opts: InitOptions): Promise<number> {
  try {
    return await run(opts);
  } catch (error) {
    if (error instanceof UsageError) {
      opts.error(error.message);
      return 2;
    }
    if (error instanceof Cancelled) {
      opts.error("Cancelled. Nothing was written.");
      return 1;
    }
    throw error;
  }
}

async function run(opts: InitOptions): Promise<number> {
  const skills = loadSkills(opts.skillsDir);
  const flags = parseFlags(opts.argv, skills.map((skill) => skill.name));
  if (flags.command === "help") return printAll(opts.log, USAGE);
  if (flags.command === "version") return printAll(opts.log, [readVersion()]);
  if (!opts.interactive && !flags.yes) {
    opts.error(NOT_A_TERMINAL);
    return 1;
  }
  const roots: Roots = { project: findProjectRoot(opts.cwd), home: opts.home };
  const answers = await chooseAnswers(flags, detectAgents(roots.project), skills);
  const plan = buildPlan(answers, skills, roots, scanFor(answers, roots));
  for (const warning of plan.warnings) opts.log(warningLine(warning, roots));
  return install({ log: opts.log, flags, roots }, answers, plan);
}

interface RunContext {
  log: InitOptions["log"];
  flags: Flags;
  roots: Roots;
}

async function install({ log, flags, roots }: RunContext, answers: Answers, plan: Plan): Promise<number> {
  const conflicts = plan.writes.filter((write) => write.status === "conflict");
  const decisions = await chooseDecisions(flags, conflicts);
  for (const write of conflicts) {
    if (decisions[write.dest] !== "replace") log(keptLine(write, roots));
  }
  const writes = resolveWrites(plan, decisions);
  if (writes.length === 0) return printAll(log, [nothingToWrite(conflicts, decisions)]);
  const review = reviewLines(plan, writes, roots);
  review.forEach((line) => log(line));
  if (!flags.yes && !unlessCancelled(await askConfirm(review))) throw new Cancelled();
  applyWrites(writes);
  return printAll(log, nextStepLines(answers.agents, answers.skills));
}

function printAll(log: InitOptions["log"], lines: string[]): number {
  lines.forEach((line) => log(line));
  return 0;
}

/** dist/cli.js and src/init.ts both sit one level below the package root. */
function readVersion(): string {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

async function chooseAnswers(flags: Flags, detected: AgentId[], skills: Skill[]): Promise<Answers> {
  const names = skills.map((skill) => skill.name);
  if (flags.yes) return resolveNonInteractive(flags, detected, names);
  const preset: Partial<Answers> = {};
  if (flags.agents) preset.agents = flags.agents;
  if (flags.skills) preset.skills = flags.skills === "all" ? names : flags.skills;
  if (flags.global) preset.scope = "global";
  const defaults: Answers = { agents: detected, scope: "project", skills: names };
  return unlessCancelled(await askAnswers(defaults, preset, skills));
}

/**
 * Only the chosen skills: full contents in the target folders (compared with ours), presence only in
 * every other folder a ticked agent reads (for duplicate warnings). Unrelated user skills are never read.
 */
function scanFor(answers: Answers, roots: Roots): Scan {
  const targets = targetFolders(answers.agents).map((folder) => folderPath(folder, answers.scope, roots));
  const others = answers.agents.flatMap((agent) => foldersReadBy(agent, roots)).filter((folder) => !targets.includes(folder));
  return { ...scanPresence([...new Set(others)], answers.skills), ...scanSkills(targets, answers.skills) };
}

function keptLine(write: SkillWrite, roots: Roots): string {
  return `Kept ${displayPath(write.dest, roots)} (differs from ours; use --replace to overwrite)`;
}

function warningLine(warning: DuplicateWarning, roots: Roots): string {
  const agents = warning.agents.map((agent) => AGENT_NAMES[agent]).join(" and ");
  return `${agents} will also load ${displayPath(`${warning.folder}${sep}${warning.skill}`, roots)}`;
}

async function chooseDecisions(flags: Flags, conflicts: SkillWrite[]): Promise<Record<string, Decision>> {
  if (conflicts.length === 0) return {};
  const all = (decision: Decision) => Object.fromEntries(conflicts.map((write) => [write.dest, decision]));
  if (flags.replace) return all("replace");
  if (flags.keepExisting || flags.yes) return all("keep");
  return unlessCancelled(await askDecisions(conflicts));
}

function nothingToWrite(conflicts: SkillWrite[], decisions: Record<string, Decision>): string {
  const kept = conflicts.filter((write) => decisions[write.dest] !== "replace").length;
  return kept === 0 ? "Everything is already up to date." : `Nothing to write. Kept ${kept} existing skill(s).`;
}
