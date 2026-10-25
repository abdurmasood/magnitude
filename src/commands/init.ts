import { readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { AGENT_NAMES, displayPath, finishedLines, nextStepLines, reviewEntries, reviewLines } from "../ui/messages.js";
import { detectAgents, findProjectRoot, scanCopies, scanSkills, type Detection } from "../install/detect.js";
import { applyFileWrites, applyRemovals, applyWrites, isMissing, readFilesRecursive } from "../install/disk.js";
import { resolveNonInteractive, type Flags } from "./flags.js";
import { recordInstalls } from "../install/ledger.js";
import { buildPlan, folderPath, foldersReadBy, resolveInstructions, resolveWrites, targetFolders, type PrinciplesContext } from "../install/plan.js";
import { firstClaudeInstruction, loadLegacySkill, loadPrinciplesBody, principleDestinations, principlesFile } from "../install/principles.js";
import { askAnswers, askConfirm, askDecisions, type Conflict } from "../ui/prompts.js";
import { foreground } from "../ui/theme.js";
import type { AgentId, Answers, Decision, DuplicateWarning, FileMap, Plan, Roots, Scan, Skill, SkillWrite } from "../install/types.js";

export interface InitOptions {
  cwd: string;
  home: string;
  interactive: boolean;
  /** Holds the bundled instructions folder; cli.ts resolves it so no other module depends on its own location. */
  packageRoot: string;
  log: (line: string) => void;
  /** Usage errors, refusals and cancellation; cli.ts sends these to stderr. */
  error: (line: string) => void;
}

const NOT_A_TERMINAL = "Not a terminal. Re-run with --yes (and --agents) to install without questions.";

/** Thrown when the user cancels any prompt; unwinds to runInit. */
class Cancelled extends Error {}

const unlessCancelled = <T>(value: T | null): T => {
  if (value === null) throw new Cancelled();
  return value;
};

export async function runInit(opts: InitOptions, flags: Flags, skills: Skill[]): Promise<number> {
  try {
    return await run(opts, flags, skills);
  } catch (error) {
    if (error instanceof Cancelled) {
      opts.error("Cancelled. Nothing was written.");
      return 1;
    }
    throw error;
  }
}

async function run(opts: InitOptions, flags: Flags, skills: Skill[]): Promise<number> {
  if (!opts.interactive && !flags.yes) {
    opts.error(NOT_A_TERMINAL);
    return 1;
  }
  const roots: Roots = { project: findProjectRoot(opts.cwd), home: opts.home };
  const seen = new Set<string>();
  const logOnce = (line: string) => {
    if (seen.has(line)) return;
    seen.add(line);
    opts.log(line);
  };
  const detected = detectAgents(roots.project);
  let answers = await chooseAnswers(flags, detected, skills);
  for (;;) {
    const plan = buildPlan(answers, skills, roots, scanFor(answers, roots), principlesFor(answers, roots, join(opts.packageRoot, "instructions")));
    for (const warning of plan.warnings) logOnce(warningLine(warning, roots));
    const outcome = await install({ log: opts.log, logOnce, flags, roots }, answers, plan);
    if (outcome !== "back") return outcome;
    answers = await chooseAnswers(flags, detected, skills, answers);
  }
}

interface RunContext {
  log: InitOptions["log"];
  /** Warnings and kept legacy skills. The same line is not printed again when review goes back. */
  logOnce: (line: string) => void;
  flags: Flags;
  roots: Roots;
}

async function install({ log, logOnce, flags, roots }: RunContext, answers: Answers, plan: Plan): Promise<number | "back"> {
  const remember = () => {
    const root = answers.scope === "global" ? roots.home : roots.project;
    recordInstalls(roots.home, root, plan.writes.map((write) => ({ name: write.skill, dest: write.dest })));
  };
  for (const dest of plan.kept) logOnce(legacyKeptLine(dest, roots));
  const label = (dest: string) => displayPath(dest, roots);
  const conflicts: Conflict[] = [
    ...plan.writes.filter((write) => write.status === "conflict").map((write) => ({ dest: write.dest, label: label(write.dest) })),
    ...plan.instructions
      .filter((write) => write.status === "conflict")
      .map((write) => ({ dest: write.dest, label: label(write.dest), instruction: true })),
  ];
  const interactive = asksDecisions(flags, conflicts);
  let startIndex = 0;
  let initial: Record<string, Decision> | undefined;
  let animate = true;
  for (;;) {
    const decisions = await chooseDecisions(flags, conflicts, { startIndex, initial, animate });
    if (decisions === "back") return "back";
    const writes = resolveWrites(plan, decisions);
    const files = resolveInstructions(plan, decisions);
    const reportKept = () => {
      for (const write of plan.writes) {
        if (write.status === "conflict" && decisions[write.dest] !== "replace") log(keptLine(write, roots));
      }
      for (const write of plan.instructions) {
        if (write.status === "conflict" && decisions[write.dest] !== "replace") log(instructionKeptLine(write.dest, roots));
      }
    };
    if (writes.length === 0 && files.length === 0 && plan.removals.length === 0) {
      reportKept();
      remember();
      return printAll(log, [nothingToWrite(conflicts, decisions)]);
    }
    const review = reviewEntries(plan, writes, roots, files, plan.removals);
    if (flags.yes) {
      reportKept();
      printAll(log, reviewLines(plan, writes, roots, files, plan.removals));
    } else {
      const confirmed = await askConfirm(review.entries, review.fileCount, !interactive, interactive || hasOpenAnswer(flags));
      if (confirmed === "back") {
        if (interactive) {
          startIndex = conflicts.length - 1;
          initial = decisions;
          animate = false;
          continue;
        }
        return "back";
      }
      if (confirmed === null || confirmed === false) throw new Cancelled();
      reportKept();
    }
    applyWrites(writes);
    applyFileWrites(files);
    applyRemovals(plan.removals.map((removal) => removal.dest));
    remember();
    if (plan.cursorPrinciplesSource) printAll(log, cursorNoteLines(plan.cursorPrinciplesSource, roots));
    if (flags.yes) return printAll(log, nextStepLines(answers.agents, answers.skills));
    return printAll(log, finishedLines(review.fileCount, answers.agents, answers.skills));
  }
}

function printAll(log: InitOptions["log"], lines: string[]): number {
  lines.forEach((line) => log(line));
  return 0;
}

async function chooseAnswers(flags: Flags, detected: Detection, skills: Skill[], previous?: Answers): Promise<Answers> {
  const names = skills.map((skill) => skill.name);
  if (flags.yes) return resolveNonInteractive(flags, detected.agents, names);
  const preset: Partial<Answers> = {};
  if (flags.agents) preset.agents = flags.agents;
  if (flags.skills) preset.skills = flags.skills === "all" ? names : flags.skills;
  if (flags.global) preset.scope = "global";
  const defaults: Answers = { agents: detected.agents, scope: "project", skills: names };
  return unlessCancelled(await askAnswers(defaults, preset, skills, detected.hints, previous === undefined ? undefined : { resume: previous }));
}

/**
 * Only the chosen skills: full contents in the target folders (compared with ours), and in every other
 * folder a ticked agent reads (for duplicate warnings). Unrelated user skills are never read.
 */
function scanFor(answers: Answers, roots: Roots): Scan {
  const targets = targetFolders(answers.agents).map((folder) => folderPath(folder, answers.scope, roots));
  const others = answers.agents.flatMap((agent) => foldersReadBy(agent, roots)).filter((folder) => !targets.includes(folder));
  return { ...scanCopies([...new Set(others)], answers.skills), ...scanSkills(targets, answers.skills) };
}

function keptLine(write: SkillWrite, roots: Roots): string {
  return `Kept ${displayPath(write.dest, roots)} (differs from ours; use --replace to overwrite)`;
}

function legacyKeptLine(dest: string, roots: Roots): string {
  return `Kept ${displayPath(dest, roots)} (old coding-principles skill was edited; remove it yourself)`;
}

function instructionKeptLine(dest: string, roots: Roots): string {
  return `Kept ${displayPath(dest, roots)} (coding principles differ; use --replace to overwrite)`;
}

const LEGACY_SKILL = "coding-principles";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** A directory's files, or a non-matching stand-in when something else is at that path. Missing is undefined. */
function readLegacy(path: string): FileMap | undefined {
  try {
    if (!statSync(path).isDirectory()) return { "SKILL.md": "" };
    return readFilesRecursive(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function principlesFor(answers: Answers, roots: Roots, instructionsDir: string): PrinciplesContext {
  const claudeFile =
    answers.scope === "project" && answers.agents.includes("claude")
      ? firstClaudeInstruction(roots.project, isFile)
      : undefined;
  const files: Record<string, string> = {};
  for (const { dest } of principleDestinations(answers.agents, answers.scope, roots, claudeFile)) {
    if (isFile(dest)) files[dest] = readFileSync(dest, "utf8");
  }
  const legacySkills: Record<string, FileMap> = {};
  for (const folder of [...new Set(answers.agents.flatMap((agent) => foldersReadBy(agent, roots)))]) {
    const dest = join(folder, LEGACY_SKILL);
    const found = readLegacy(dest);
    if (found) legacySkills[dest] = found;
  }
  return { body: loadPrinciplesBody(instructionsDir), bodyFile: principlesFile(instructionsDir), claudeFile, files, legacy: loadLegacySkill(instructionsDir), legacySkills };
}

function warningLine(warning: DuplicateWarning, roots: Roots): string {
  const agents = warning.agents.map((agent) => AGENT_NAMES[agent]).join(" and ");
  const path = displayPath(`${warning.folder}${sep}${warning.skill}`, roots);
  return foreground("yellow", `▲ ${path} differs from magnitude's. ${agents} will load both.`);
}

function cursorNoteLines(source: string, roots: Roots): string[] {
  return [
    foreground("yellow", "▲ Cursor won't get the coding principles. It has no global rules file."),
    `  Paste them from ${displayPath(source, roots)} into Cursor Settings › Rules › User Rules.`,
    "",
  ];
}

function asksDecisions(flags: Flags, conflicts: Conflict[]): boolean {
  return conflicts.length > 0 && !flags.replace && !flags.keepExisting && !flags.yes;
}

/** An answer section is still on screen, so Left from review can return to it. */
function hasOpenAnswer(flags: Flags): boolean {
  return flags.agents === undefined || flags.skills === undefined || !flags.global;
}

async function chooseDecisions(
  flags: Flags,
  conflicts: Conflict[],
  opts?: { startIndex?: number; initial?: Record<string, Decision>; animate?: boolean },
): Promise<Record<string, Decision> | "back"> {
  if (asksDecisions(flags, conflicts)) {
    const asked = await askDecisions(conflicts, {
      startIndex: opts?.startIndex ?? 0,
      initial: opts?.initial,
      allowBack: hasOpenAnswer(flags),
      animate: opts?.animate !== false,
    });
    if (asked === "back") return "back";
    return unlessCancelled(asked);
  }
  const decision: Decision = flags.replace ? "replace" : "keep";
  return Object.fromEntries(conflicts.map((write) => [write.dest, decision]));
}

function nothingToWrite(conflicts: { dest: string }[], decisions: Record<string, Decision>): string {
  const kept = conflicts.filter((write) => decisions[write.dest] !== "replace").length;
  const check = foreground("green", "✓");
  return kept === 0 ? `${check} Up to date. Nothing to write.` : `${check} Nothing to write. Kept ${kept} existing skill(s).`;
}
