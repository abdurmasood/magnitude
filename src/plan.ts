import type { AgentId, FileMap, FolderKey, Skill } from "./types.js";

export const CODEX_MANUAL_YAML = "policy:\n  allow_implicit_invocation: false\n";

const AGENT_ORDER: AgentId[] = ["claude", "cursor", "codex"];

const FOLDER_READERS: Record<FolderKey, AgentId[]> = {
  ".claude/skills": ["claude", "cursor"],
  ".agents/skills": ["cursor", "codex"],
  ".cursor/skills": ["cursor"],
};

/** Cursor reads both shared folders, so it only forces one when no other agent already does. */
export function targetFolders(agents: AgentId[]): FolderKey[] {
  if (agents.length === 0) return [];
  const folders: FolderKey[] = [];
  if (agents.includes("claude")) folders.push(".claude/skills");
  if (agents.includes("codex") || !agents.includes("claude")) folders.push(".agents/skills");
  return folders;
}

export function readersOf(folder: FolderKey, agents: AgentId[]): AgentId[] {
  return AGENT_ORDER.filter((agent) => agents.includes(agent) && FOLDER_READERS[folder].includes(agent));
}

export function expectedFiles(skill: Skill, folder: FolderKey): FileMap {
  const files: FileMap = { ...skill.files };
  if (skill.manualOnly && folder === ".agents/skills") files["agents/openai.yaml"] = CODEX_MANUAL_YAML;
  return files;
}
