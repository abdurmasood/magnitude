import { existsSync, lstatSync, statSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { isMissing, readFilesRecursive } from "./skills.js";
import type { AgentId, Scan } from "./types.js";

/** Stats `path`, or undefined when it (or a link it follows) does not exist; any other error is rethrown. */
function statOrMissing(path: string, follow = true): Stats | undefined {
  try {
    return follow ? statSync(path) : lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

const isDirectory = (path: string): boolean => statOrMissing(path)?.isDirectory() === true;
const isFile = (path: string): boolean => statOrMissing(path)?.isFile() === true;

/** Nearest ancestor containing `.git` (folder or worktree file); `cwd` itself when none is found. */
export function findProjectRoot(cwd: string): string {
  let current = cwd;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

interface Signal {
  name: string;
  kind: "dir" | "file";
}

const AGENT_ORDER: AgentId[] = ["claude", "cursor", "codex"];

/** Project entries only one agent uses: each names that agent outright. */
const OWN_SIGNALS: (Signal & { agent: AgentId })[] = [
  { agent: "claude", name: "CLAUDE.md", kind: "file" },
  { agent: "claude", name: ".claude", kind: "dir" },
  { agent: "cursor", name: ".cursor", kind: "dir" },
  { agent: "cursor", name: ".cursorrules", kind: "file" },
  { agent: "codex", name: ".codex", kind: "dir" },
];

/** Project entries several agents read, so they can't say which agent the project uses. */
const SHARED_SIGNALS: (Signal & { readers: AgentId[] })[] = [
  { name: "AGENTS.md", kind: "file", readers: ["cursor", "codex"] },
  { name: ".agents", kind: "dir", readers: ["cursor", "codex"] },
];

const present = (root: string, signal: Signal): boolean =>
  (signal.kind === "dir" ? isDirectory : isFile)(join(root, signal.name));
const shown = (signal: Signal): string => (signal.kind === "dir" ? `${signal.name}/` : signal.name);

/** Agents to pre-tick, plus the reason shown beside an agent in the picker, ticked or not. */
export interface Detection {
  agents: AgentId[];
  hints: Partial<Record<AgentId, string>>;
}

/** Ticks only agents a project entry names outright; shared entries leave their readers unticked, with a hint. */
export function detectAgents(project: string): Detection {
  const hints: Partial<Record<AgentId, string>> = {};
  const own = OWN_SIGNALS.filter((signal) => present(project, signal));
  for (const signal of own) hints[signal.agent] ??= `found ${shown(signal)}`;
  const ticked = new Set(own.map((signal) => signal.agent));
  for (const signal of SHARED_SIGNALS.filter((signal) => present(project, signal))) {
    for (const agent of signal.readers) hints[agent] ??= `${shown(signal)} found`;
  }
  return { agents: AGENT_ORDER.filter((agent) => ticked.has(agent)), hints };
}

type ReadSkill = (path: string) => Scan[string][string];

/** Records each named entry of any type found in each existing folder, keyed by the folder string given. */
function scanNamed(folders: string[], names: string[], read: ReadSkill): Scan {
  const scan: Scan = {};
  for (const folder of folders) {
    if (!isDirectory(folder)) continue;
    const skills: Scan[string] = {};
    for (const name of names) {
      const path = join(folder, name);
      // Any same-named entry (file, broken link) must surface, or the planner would overwrite it as "new".
      if (statOrMissing(path, false)) skills[name] = read(path);
    }
    scan[folder] = skills;
  }
  return scan;
}

/** Target folders: reads the full contents of each named skill so it can be compared with ours. */
export function scanSkills(folders: string[], names: string[]): Scan {
  return scanNamed(folders, names, (path) => (isDirectory(path) ? readFilesRecursive(path) : {}));
}

/** Other folders: only whether each named skill is there, without reading it. */
export function scanPresence(folders: string[], names: string[]): Scan {
  return scanNamed(folders, names, () => ({}));
}
