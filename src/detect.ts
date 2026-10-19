import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFilesRecursive } from "./skills.js";
import type { AgentId, Scan } from "./types.js";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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

/** Snapshots each existing folder's skill subfolders (those with SKILL.md), keyed by the folder string given. */
export function scanFolders(folders: string[]): Scan {
  const scan: Scan = {};
  for (const folder of folders) {
    if (!isDirectory(folder)) continue;
    const skills: Scan[string] = {};
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const files = readFilesRecursive(join(folder, entry.name));
      if (files["SKILL.md"] !== undefined) skills[entry.name] = files;
    }
    scan[folder] = skills;
  }
  return scan;
}
