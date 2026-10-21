import { styleText } from "node:util";
import { pick } from "./picker.js";
import type { AgentId, Answers, Decision, Scope, Skill } from "./types.js";
import { plural, type ReviewEntry } from "./write.js";

const AGENT_OPTIONS: { value: AgentId; label: string; signal: string }[] = [
  { value: "claude", label: "Claude Code", signal: "found .claude/" },
  { value: "cursor", label: "Cursor", signal: "found .cursor/" },
  { value: "codex", label: "Codex", signal: "found .agents/, .codex/ or AGENTS.md" },
];

const HINT_WIDTH = 60;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > HINT_WIDTH ? `${flat.slice(0, HINT_WIDTH - 1)}…` : flat;
}

async function askAgents(detected: AgentId[]): Promise<AgentId[] | null> {
  return pick({
    message: "Which agents do you use?",
    options: AGENT_OPTIONS.map(({ value, label, signal }) => ({
      value,
      label,
      hint: detected.includes(value) ? signal : undefined,
    })),
    initial: detected,
    multiple: true,
    step: 0,
    body: detected.length > 0 ? [styleText("dim", `Found ${detected.length}.`)] : undefined,
    required: true,
  });
}

async function askScope(initial: Scope): Promise<Scope | null> {
  const answer = await pick<Scope>({
    message: "Where should the skills go?",
    options: [
      { value: "project", label: "This project", hint: "shared with the team via git" },
      { value: "global", label: "Global", hint: "every project on this machine" },
    ],
    initial: [initial],
    multiple: false,
    step: 1,
  });
  if (answer === null) return null;
  return answer[0];
}

async function askSkills(initial: string[], skills: Skill[]): Promise<string[] | null> {
  return pick({
    message: "Which skills?",
    options: skills.map((skill) => ({ value: skill.name, label: skill.name, hint: oneLine(skill.description) })),
    initial,
    multiple: true,
    step: 2,
    required: true,
  });
}

/** Asks only the questions that `preset` leaves open. */
export async function askAnswers(defaults: Answers, preset: Partial<Answers>, skills: Skill[]): Promise<Answers | null> {
  const agents = preset.agents ?? (await askAgents(defaults.agents));
  if (agents === null) return null;
  const scope = preset.scope ?? (await askScope(defaults.scope));
  if (scope === null) return null;
  const chosen = preset.skills ?? (await askSkills(defaults.skills, skills));
  if (chosen === null) return null;
  return { agents, scope, skills: chosen };
}

/** `label` is the short path shown in the question; answers are keyed by `dest`. */
export interface Conflict {
  dest: string;
  label: string;
  instruction?: boolean;
}

export async function askDecisions(conflicts: Conflict[]): Promise<Record<string, Decision> | null> {
  const decisions: Record<string, Decision> = {};
  for (const conflict of conflicts) {
    const answer = await pick<Decision>({
      message: conflict.instruction
        ? `Coding principles in ${conflict.label} differ. Replace them?`
        : `${conflict.label} already exists and differs. Replace it?`,
      options: [
        { value: "keep", label: "No, keep mine" },
        { value: "replace", label: "Yes, replace" },
      ],
      initial: ["keep"],
      multiple: false,
      step: 3,
    });
    if (answer === null) return null;
    decisions[conflict.dest] = answer[0];
  }
  return decisions;
}

/** A blank line, then one row per entry: the path padded to a column, then the detail dimmed. */
function entryLines(entries: ReviewEntry[]): string[] {
  const width = Math.max(0, ...entries.map((entry) => entry.path.length)) + 2;
  return ["", ...entries.map((entry) => `  ${entry.path.padEnd(width)}${styleText("dim", entry.detail)}`)];
}

export async function askConfirm(entries: ReviewEntry[], fileCount: number): Promise<boolean | null> {
  const answer = await pick({
    message: `Write ${plural(fileCount, "file")}?`,
    body: entryLines(entries),
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
    initial: [true],
    multiple: false,
    step: 3,
  });
  if (answer === null) return null;
  return answer[0];
}
