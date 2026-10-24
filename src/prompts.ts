import { styleText } from "node:util";
import { wizard, type WizardPage } from "./picker.js";
import type { AgentId, Answers, Decision, Scope, Skill } from "./types.js";
import { plural, type ReviewEntry } from "./copy.js";

const AGENT_OPTIONS: { value: AgentId; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "codex", label: "Codex" },
];

type AgentHints = Partial<Record<AgentId, string>>;

const HINT_WIDTH = 60;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > HINT_WIDTH ? `${flat.slice(0, HINT_WIDTH - 1)}…` : flat;
}

/** `hints` holds the detection reason for each pre-ticked agent. `resume` reopens on the last open question. */
export async function askAnswers(
  defaults: Answers,
  preset: Partial<Answers>,
  skills: Skill[],
  hints: AgentHints,
  opts?: { resume?: Answers },
): Promise<Answers | null> {
  const chosen = opts?.resume;
  const pages: WizardPage<string>[] = [];
  if (preset.agents === undefined) {
    const initial = chosen?.agents ?? defaults.agents;
    pages.push({
      message: "Which agents do you use?",
      options: AGENT_OPTIONS.map(({ value, label }) => ({ value, label, hint: hints[value] })),
      initial,
      multiple: true,
      required: true,
      requiredHint: "select an agent to continue",
      step: 0,
      rise: false,
      body: defaults.agents.length > 0 ? [styleText("dim", `Found ${defaults.agents.length}.`)] : undefined,
    });
  }
  if (preset.scope === undefined) {
    pages.push({
      message: "Where should the skills go?",
      options: [
        { value: "project", label: "This project", hint: "shared with the team via git" },
        { value: "global", label: "Global", hint: "every project on this machine" },
      ],
      initial: [chosen?.scope ?? defaults.scope],
      multiple: false,
      step: 1,
    });
  }
  if (preset.skills === undefined) {
    pages.push({
      message: "Which skills?",
      options: skills.map((skill) => ({ value: skill.name, label: skill.name, hint: oneLine(skill.description) })),
      initial: chosen?.skills ?? defaults.skills,
      multiple: true,
      required: true,
      requiredHint: "select a skill to continue",
      step: 2,
    });
  }
  if (pages.length === 0) {
    return {
      agents: preset.agents ?? chosen?.agents ?? defaults.agents,
      scope: preset.scope ?? chosen?.scope ?? defaults.scope,
      skills: preset.skills ?? chosen?.skills ?? defaults.skills,
    };
  }
  const result = await wizard(pages, {
    allowBack: false,
    rightOnLast: "done",
    startIndex: chosen === undefined ? 0 : pages.length - 1,
  });
  if (result === null) return null;
  let index = 0;
  const agents = preset.agents ?? (result.answers[index++] as AgentId[]);
  const scope = (preset.scope ?? result.answers[index++][0]) as Scope;
  const picked = preset.skills ?? result.answers[index++];
  return { agents, scope, skills: picked };
}

/** `label` is the short path shown in the question; answers are keyed by `dest`. */
export interface Conflict {
  dest: string;
  label: string;
  instruction?: boolean;
}

export interface DecisionOptions {
  startIndex?: number;
  initial?: Record<string, Decision>;
  /** Left from the first conflict returns to the answer sections. */
  allowBack?: boolean;
  /** Replay the review bar. Off when returning from the confirm screen. */
  animate?: boolean;
}

export async function askDecisions(
  conflicts: Conflict[],
  opts?: DecisionOptions,
): Promise<Record<string, Decision> | "back" | null> {
  const pages: WizardPage<string>[] = conflicts.map((conflict, index) => ({
    message: conflict.instruction
      ? `Coding principles in ${conflict.label} differ. Replace them?`
      : `${conflict.label} already exists and differs. Replace it?`,
    options: [
      { value: "keep", label: "No, keep mine" },
      { value: "replace", label: "Yes, replace" },
    ],
    initial: [opts?.initial?.[conflict.dest] ?? "keep"],
    multiple: false,
    step: 3,
    rise: index === 0,
  }));
  const result = await wizard(pages, {
    allowBack: opts?.allowBack !== false,
    rightOnLast: "done",
    startIndex: opts?.startIndex ?? 0,
    animate: opts?.animate !== false,
  });
  if (result === null) return null;
  if (result.exit === "back") return "back";
  return Object.fromEntries(conflicts.map((conflict, index) => [conflict.dest, result.answers[index][0] as Decision]));
}

/** A blank line, then one row per entry: the path padded to a column, then the detail dimmed. */
function entryLines(entries: ReviewEntry[]): string[] {
  const width = Math.max(0, ...entries.map((entry) => entry.path.length)) + 2;
  return ["", ...entries.map((entry) => `  ${entry.path.padEnd(width)}${styleText("dim", entry.detail)}`)];
}

/** `rise` is false when conflict questions already showed step 3. Left returns `"back"`. */
export async function askConfirm(
  entries: ReviewEntry[],
  fileCount: number,
  rise: boolean,
  allowBack = false,
): Promise<boolean | "back" | null> {
  const result = await wizard(
    [
      {
        message: `Write ${plural(fileCount, "file")}?`,
        body: entryLines(entries),
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        initial: ["yes"],
        multiple: false,
        step: 3,
        rise,
      },
    ],
    { allowBack, rightOnLast: "stop", animate: rise },
  );
  if (result === null) return null;
  if (result.exit === "back") return "back";
  return result.answers[0][0] === "yes";
}
