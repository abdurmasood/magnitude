import { parseArgs } from "node:util";
import type { AgentId, Answers } from "../install/types.js";

export interface Flags {
  command: "init" | "help" | "version" | "update";
  agents?: AgentId[];
  skills?: string[] | "all";
  global: boolean;
  replace: boolean;
  keepExisting: boolean;
  yes: boolean;
}

export class UsageError extends Error {
  override name = "UsageError";
}

const VALID_AGENTS: AgentId[] = ["claude", "cursor", "codex"];

function splitList(raw: string, flag: string): string[] {
  const items = [...new Set(raw.split(",").map((piece) => piece.trim()).filter(Boolean))];
  if (items.length === 0) throw new UsageError(`${flag} needs at least one value`);
  return items;
}

function parseAgents(raw: string): AgentId[] {
  const items = splitList(raw, "--agents");
  const unknown = items.filter((item) => !VALID_AGENTS.includes(item as AgentId));
  if (unknown.length > 0) {
    throw new UsageError(`Unknown agent: ${unknown.join(", ")}. Valid agents: ${VALID_AGENTS.join(", ")}`);
  }
  return items as AgentId[];
}

function parseSkills(raw: string, validSkills: string[]): string[] | "all" {
  if (raw === "all") return "all";
  const items = splitList(raw, "--skills");
  const unknown = items.filter((item) => !validSkills.includes(item));
  if (unknown.length > 0) {
    throw new UsageError(`Unknown skill: ${unknown.join(", ")}. Valid skills: ${validSkills.join(", ")}`);
  }
  return items;
}

function readArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        agents: { type: "string" },
        skills: { type: "string" },
        global: { type: "boolean", default: false },
        replace: { type: "boolean", default: false },
        "keep-existing": { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function pickCommand(help: boolean, version: boolean, positionals: string[]): Flags["command"] {
  if (help) return "help";
  if (version) return "version";
  if (positionals.length === 0) return "help";
  if (positionals.length > 1) throw new UsageError(`Unexpected argument: ${positionals[1]}`);
  const name = positionals[0];
  if (name === "init" || name === "update") return name;
  throw new UsageError(`Unknown command: ${name}`);
}

export function parseFlags(argv: string[], validSkills: string[]): Flags {
  const { values, positionals } = readArgs(argv);
  const command = pickCommand(values.help === true, values.version === true, positionals);
  const hasUpdateOption =
    values.agents !== undefined ||
    values.skills !== undefined ||
    values.global === true ||
    values.replace === true ||
    values["keep-existing"] === true ||
    values.yes === true;
  if (command === "update" && hasUpdateOption) throw new UsageError("magnitude update takes no options");
  if (values.replace && values["keep-existing"]) {
    throw new UsageError("--replace and --keep-existing cannot be used together");
  }
  return {
    command,
    agents: values.agents === undefined ? undefined : parseAgents(values.agents),
    skills: values.skills === undefined ? undefined : parseSkills(values.skills, validSkills),
    global: values.global === true,
    replace: values.replace === true,
    keepExisting: values["keep-existing"] === true,
    yes: values.yes === true,
  };
}

export function resolveNonInteractive(flags: Flags, detected: AgentId[], validSkills: string[]): Answers {
  const agents = flags.agents ?? detected;
  if (agents.length === 0) {
    throw new UsageError("No agents detected. Pass --agents claude,cursor,codex (any of them).");
  }
  const skills = flags.skills === undefined || flags.skills === "all" ? [...validSkills] : flags.skills;
  return { agents, scope: flags.global ? "global" : "project", skills };
}
