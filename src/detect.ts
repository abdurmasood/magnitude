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

export function detectAgents(root: string): AgentId[] {
  const agents: AgentId[] = [];
  if (isDirectory(join(root, ".claude"))) agents.push("claude");
  if (isDirectory(join(root, ".cursor"))) agents.push("cursor");
  if (
    isDirectory(join(root, ".agents")) ||
    isDirectory(join(root, ".codex")) ||
    isFile(join(root, "AGENTS.md"))
  ) {
    agents.push("codex");
  }
  return agents;
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
