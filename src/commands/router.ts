import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit, type InitOptions } from "./init.js";
import { runUpdateCommand, type UpdateHooks } from "./update.js";
import { parseFlags, UsageError } from "./flags.js";
import { loadSkills } from "../install/skills.js";

export interface CommandOptions extends InitOptions {
  argv: string[];
  skillsDir: string;
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

export async function runCommand(opts: CommandOptions): Promise<number> {
  try {
    return await run(opts);
  } catch (error) {
    if (error instanceof UsageError) {
      opts.error(error.message);
      return 2;
    }
    throw error;
  }
}

async function run(opts: CommandOptions): Promise<number> {
  const skills = loadSkills(opts.skillsDir);
  const flags = parseFlags(opts.argv, skills.map((skill) => skill.name));
  if (flags.command === "help") return printAll(opts.log, USAGE);
  if (flags.command === "version") return printAll(opts.log, [readVersion(opts.packageRoot)]);
  if (flags.command === "update") return runUpdateCommand(opts, readVersion(opts.packageRoot));
  return runInit(opts, flags, skills);
}

function printAll(log: CommandOptions["log"], lines: string[]): number {
  lines.forEach((line) => log(line));
  return 0;
}

function readVersion(packageRoot: string): string {
  const path = join(packageRoot, "package.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}
