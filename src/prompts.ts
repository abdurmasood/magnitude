import { confirm, isCancel, multiselect, select } from "@clack/prompts";
import type { AgentId, Answers, Decision, Scope, Skill, SkillWrite } from "./types.js";

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

/** clack returns a cancel symbol on Ctrl-C; callers only see null. */
const orNull = <T>(value: T): Exclude<T, symbol> | null => (isCancel(value) ? null : (value as Exclude<T, symbol>));

async function askAgents(detected: AgentId[]): Promise<AgentId[] | null> {
  const answer = await multiselect<AgentId>({
    message: "Which agents do you use? (space to toggle, enter to confirm)",
    options: AGENT_OPTIONS.map(({ value, label, signal }) => ({
      value,
      label,
      hint: detected.includes(value) ? signal : undefined,
    })),
    initialValues: detected,
    required: true,
  });
  return orNull(answer);
}

async function askScope(initial: Scope): Promise<Scope | null> {
  const answer = await select<Scope>({
    message: "Where should the skills go?",
    options: [
      { value: "project", label: "This project", hint: "shared with the team via git" },
      { value: "global", label: "Global", hint: "every project on this machine" },
    ],
    initialValue: initial,
  });
  return orNull(answer);
}

async function askSkills(initial: string[], skills: Skill[]): Promise<string[] | null> {
  const answer = await multiselect<string>({
    message: "Which skills?",
    options: skills.map((skill) => ({ value: skill.name, label: skill.name, hint: oneLine(skill.description) })),
    initialValues: initial,
    required: true,
  });
  return orNull(answer);
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

export async function askDecisions(conflicts: SkillWrite[]): Promise<Record<string, Decision> | null> {
  const decisions: Record<string, Decision> = {};
  for (const conflict of conflicts) {
    const answer = await select<Decision>({
      message: `${conflict.dest} already exists and differs. Replace it?`,
      options: [
        { value: "keep", label: "No, keep mine" },
        { value: "replace", label: "Yes, replace" },
      ],
      initialValue: "keep",
    });
    const decision = orNull(answer);
    if (decision === null) return null;
    decisions[conflict.dest] = decision;
  }
  return decisions;
}

/** `lines` are the review lines, already printed by the caller; the last one is the file total. */
export async function askConfirm(lines: string[]): Promise<boolean | null> {
  return orNull(await confirm({ message: `Write them? (${lines[lines.length - 1]})` }));
}
