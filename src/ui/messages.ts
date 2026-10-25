import { relative, sep } from "node:path";
import { styleText } from "node:util";
import { DOCS_URL, foreground, headerLine, STEPS, stepperLine } from "./theme.js";
import type { AgentId, FinalWrite, Plan, Roots, SkillRemoval } from "../install/types.js";

export const AGENT_NAMES: Record<AgentId, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };

/** Project paths relative to the project root, home paths under `~`, anything else unchanged. */
export function displayPath(path: string, roots: Roots): string {
  if (path.startsWith(roots.project + sep)) return relative(roots.project, path).split(sep).join("/");
  if (path.startsWith(roots.home + sep)) return `~/${relative(roots.home, path).split(sep).join("/")}`;
  return path;
}

export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export interface ReviewEntry {
  path: string;
  detail: string;
  removal: boolean;
}

export interface Review {
  entries: ReviewEntry[];
  fileCount: number;
}

export function reviewEntries(
  plan: Plan,
  writes: FinalWrite[],
  roots: Roots,
  files: { dest: string }[] = [],
  removals: SkillRemoval[] = [],
): Review {
  const written = new Set(writes.map((write) => write.dest));
  const folders = new Map<string, { skills: number; readers: AgentId[] }>();
  for (const planned of plan.writes) {
    if (!written.has(planned.dest)) continue;
    const entry = folders.get(planned.folder) ?? { skills: 0, readers: planned.readers };
    entry.skills += 1;
    folders.set(planned.folder, entry);
  }
  const entry = (dest: string, detail: string, removal = false) => ({ path: displayPath(dest, roots), detail, removal });
  const entries = [
    ...[...folders].map(([folder, { skills, readers }]) =>
      entry(folder, `${plural(skills, "skill")}, read by ${readers.map((agent) => AGENT_NAMES[agent]).join(", ")}`),
    ),
    ...files.map((file) => entry(file.dest, "coding principles")),
    ...removals.map((removal) => entry(removal.dest, "remove", true)),
  ];
  const fileCount = writes.reduce((sum, write) => sum + Object.keys(write.files).length, 0) + files.length;
  return { entries, fileCount };
}

export function reviewLines(...args: Parameters<typeof reviewEntries>): string[] {
  const { entries, fileCount } = reviewEntries(...args);
  const lines = entries.map((entry) => (entry.removal ? `remove ${entry.path}` : `${entry.path}: ${entry.detail}`));
  return [...lines, `${plural(fileCount, "file")} total`];
}

export interface NextStep {
  command: string;
  agents: AgentId[];
}

export function nextSteps(agents: AgentId[], skills: string[]): NextStep[] {
  const skill = skills.includes("calibrate") ? "calibrate" : skills[0];
  const slash = (["claude", "cursor"] as const).filter((agent) => agents.includes(agent));
  const steps: NextStep[] = [];
  if (slash.length > 0) steps.push({ command: `/${skill}`, agents: slash });
  if (agents.includes("codex")) steps.push({ command: `$${skill}`, agents: ["codex"] });
  return steps;
}

const agentNames = (agents: AgentId[]): string => agents.map((agent) => AGENT_NAMES[agent]).join(" / ");

export function nextStepLines(agents: AgentId[], skills: string[]): string[] {
  return nextSteps(agents, skills).map((step) => `${agentNames(step.agents)}: ${step.command}`);
}

/** The interactive closing screen. `--yes` prints nextStepLines instead. */
export function finishedLines(fileCount: number, agents: AgentId[], skills: string[]): string[] {
  const next = nextSteps(agents, skills).map((step, index) => {
    const lead = styleText("dim", index === 0 ? "Next  " : "      ");
    return `${lead}${foreground("magenta", styleText("bold", step.command))}${styleText("dim", `  in ${agentNames(step.agents)}`)}`;
  });
  const wrote = styleText("bold", `Wrote ${plural(fileCount, "file")}.`);
  return [headerLine(), "", stepperLine(STEPS.length), "", wrote, "", ...next, `${styleText("dim", "Docs  ")}${styleText("dim", DOCS_URL)}`];
}
