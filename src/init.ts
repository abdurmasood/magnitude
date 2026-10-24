import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_NAMES, displayPath, finishedLines, nextStepLines, reviewEntries, reviewLines } from "./copy.js";
import { detectAgents, findProjectRoot, scanPresence, scanSkills, type Detection } from "./detect.js";
import { applyFileWrites, applyRemovals, applyWrites, isMissing, readFilesRecursive } from "./disk.js";
import { parseFlags, resolveNonInteractive, UsageError, type Flags } from "./flags.js";
import { recordInstalls } from "./ledger.js";
import { buildPlan, folderPath, foldersReadBy, resolveInstructions, resolveWrites, targetFolders, type PrinciplesContext } from "./plan.js";
import { firstClaudeInstruction, loadLegacySkill, loadPrinciplesBody, principleDestinations } from "./principles.js";
import { askAnswers, askConfirm, askDecisions, type Conflict } from "./prompts.js";
import { loadSkills } from "./skills.js";
import type { AgentId, Answers, Decision, DuplicateWarning, FileMap, Plan, Roots, Scan, Skill, SkillWrite } from "./types.js";
import {
  APPLY_ENV,
  applyRecordedSkills,
  currentPackagePath,
  defaultHasPackageJson,
  fetchLatestVersion,
  installPackage,
  reexecApply,
  runUpdate,
  type UpdateHooks,
} from "./update.js";

export interface InitOptions {
  argv: string[];
  cwd: string;
  home: string;
  skillsDir: string;
  interactive: boolean;
  log: (line: string) => void;
  /** Usage errors, refusals and cancellation; cli.ts sends these to stderr. */
  error: (line: string) => void;
  /** Injected by tests so update never talks to the network or a package manager. */
  update?: UpdateHooks;
}

const USAGE = [
  "Usage:",
  "  magnitude init [--agents claude,cursor,codex] [--skills all|name,name]",
  "                 [--global] [--replace | --keep-existing] [--yes]",
  "  magnitude update",
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
  if (flags.command === "update") return runUpdateCommand(opts);
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
    const plan = buildPlan(answers, skills, roots, scanFor(answers, roots), principlesFor(answers, roots));
    for (const warning of plan.warnings) logOnce(warningLine(warning, roots));
    const outcome = await install({ log: opts.log, logOnce, flags, roots }, answers, plan);
    if (outcome !== "back") return outcome;
    answers = await chooseAnswers(flags, detected, skills, answers);
  }
}

interface RunContext {
  log: InitOptions["log"];
  /** Warnings and notes. The same line is not printed again when review goes back. */
  logOnce: (line: string) => void;
  flags: Flags;
  roots: Roots;
}

async function install({ log, logOnce, flags, roots }: RunContext, answers: Answers, plan: Plan): Promise<number | "back"> {
  const remember = () => {
    const root = answers.scope === "global" ? roots.home : roots.project;
    recordInstalls(roots.home, root, plan.writes.map((write) => ({ name: write.skill, dest: write.dest })));
  };
  for (const note of plan.notes) logOnce(note);
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
    if (flags.yes) return printAll(log, nextStepLines(answers.agents, answers.skills));
    return printAll(log, finishedLines(review.fileCount, answers.agents, answers.skills));
  }
}

async function runUpdateCommand(opts: InitOptions): Promise<number> {
  if (process.env[APPLY_ENV] === "1") return applyRecordedSkills(opts.home, opts.skillsDir, opts.log);
  const hooks = opts.update;
  return runUpdate({
    packagePath: hooks?.packagePath ?? currentPackagePath(),
    currentVersion: hooks?.currentVersion ?? readVersion(),
    latest: hooks?.latest ?? fetchLatestVersion,
    install: hooks?.install ?? installPackage,
    apply: hooks?.apply ?? reexecApply,
    hasPackageJson: hooks?.hasPackageJson ?? defaultHasPackageJson,
    log: opts.log,
    error: opts.error,
  });
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

function principlesFor(answers: Answers, roots: Roots): PrinciplesContext {
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
  return { body: loadPrinciplesBody(), claudeFile, files, legacy: loadLegacySkill(), legacySkills };
}

function warningLine(warning: DuplicateWarning, roots: Roots): string {
  const agents = warning.agents.map((agent) => AGENT_NAMES[agent]).join(" and ");
  return `${agents} will also load ${displayPath(`${warning.folder}${sep}${warning.skill}`, roots)}`;
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
  return kept === 0 ? "Everything is already up to date." : `Nothing to write. Kept ${kept} existing skill(s).`;
}
