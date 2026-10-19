import { join } from "node:path";
import type {
  Answers,
  AgentId,
  Decision,
  DuplicateWarning,
  FileMap,
  FinalWrite,
  FolderKey,
  Plan,
  Roots,
  Scan,
  Scope,
  Skill,
  SkillWrite,
  WriteStatus,
} from "./types.js";

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

const ALL_FOLDERS: FolderKey[] = [".claude/skills", ".agents/skills", ".cursor/skills"];

export function folderPath(folder: FolderKey, scope: Scope, roots: Roots): string {
  return join(scope === "project" ? roots.project : roots.home, folder);
}

export function foldersReadBy(agent: AgentId, roots: Roots): string[] {
  const read = ALL_FOLDERS.filter((folder) => FOLDER_READERS[folder].includes(agent));
  return [roots.project, roots.home].flatMap((root) => read.map((folder) => join(root, folder)));
}

const normalize = (files: FileMap): FileMap =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text.replace(/\r\n/g, "\n")]));

function statusOf(existing: FileMap | undefined, expected: FileMap): WriteStatus {
  if (!existing) return "new";
  const have = normalize(existing);
  const want = normalize(expected);
  const same = Object.keys(have).length === Object.keys(want).length && Object.keys(want).every((path) => have[path] === want[path]);
  return same ? "identical" : "conflict";
}

function buildWrites(answers: Answers, chosen: Skill[], roots: Roots, scan: Scan): SkillWrite[] {
  return targetFolders(answers.agents).flatMap((folder) => {
    const folderDir = folderPath(folder, answers.scope, roots);
    return chosen.map((skill) => {
      const files = expectedFiles(skill, folder);
      return {
        skill: skill.name,
        folder: folderDir,
        dest: join(folderDir, skill.name),
        files,
        status: statusOf(scan[folderDir]?.[skill.name], files),
        readers: readersOf(folder, answers.agents),
      };
    });
  });
}

function buildWarnings(answers: Answers, chosen: Skill[], roots: Roots, scan: Scan, writes: SkillWrite[]): DuplicateWarning[] {
  const targets = new Set(writes.map((write) => write.folder));
  const ticked = AGENT_ORDER.filter((agent) => answers.agents.includes(agent));
  const readBy = new Map(ticked.map((agent) => [agent, foldersReadBy(agent, roots)]));
  const folders = [...new Set([...readBy.values()].flat())].filter((folder) => !targets.has(folder));
  return folders.flatMap((folder) =>
    chosen
      .filter((skill) => scan[folder]?.[skill.name])
      .map((skill) => ({
        skill: skill.name,
        folder,
        agents: ticked.filter((agent) => readBy.get(agent)!.includes(folder)),
      })),
  );
}

export function buildPlan(answers: Answers, skills: Skill[], roots: Roots, scan: Scan): Plan {
  const chosen = answers.skills.map((name) => skills.find((skill) => skill.name === name)).filter((s): s is Skill => !!s);
  const writes = buildWrites(answers, chosen, roots, scan);
  return { writes, warnings: buildWarnings(answers, chosen, roots, scan, writes) };
}

export function resolveWrites(plan: Plan, decisions: Record<string, Decision>): FinalWrite[] {
  return plan.writes.flatMap((write): FinalWrite[] => {
    if (write.status === "new") return [{ dest: write.dest, files: write.files, mode: "create" }];
    if (write.status === "conflict" && decisions[write.dest] === "replace") {
      return [{ dest: write.dest, files: write.files, mode: "replace" }];
    }
    return [];
  });
}
