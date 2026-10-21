import { join } from "node:path";
import { CURSOR_GLOBAL_NOTE, legacySkillMatches, principleDestinations, upsertPrinciples } from "./principles.js";
import type {
  Answers,
  AgentId,
  Decision,
  DuplicateWarning,
  FileMap,
  FinalWrite,
  FolderKey,
  InstructionWrite,
  Plan,
  Roots,
  Scan,
  Scope,
  Skill,
  SkillRemoval,
  SkillWrite,
  WriteStatus,
} from "./types.js";
import { displayPath } from "./write.js";

export interface PrinciplesContext {
  body: string;
  claudeFile?: string;
  /** Absolute path -> text. A missing key means the file is not there. */
  files: Record<string, string>;
  legacy: FileMap;
  /** Absolute coding-principles folder -> its files. Only folders that exist. */
  legacySkills: Record<string, FileMap>;
}

const LEGACY_SKILL = "coding-principles";

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

function buildWarnings(answers: Answers, chosen: Skill[], roots: Roots, scan: Scan): DuplicateWarning[] {
  const targets = new Set(targetFolders(answers.agents).map((folder) => folderPath(folder, answers.scope, roots)));
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

function buildInstructions(answers: Answers, roots: Roots, principles: PrinciplesContext | undefined): InstructionWrite[] {
  if (!principles) return [];
  const claudeFile = answers.agents.includes("claude") ? principles.claudeFile : undefined;
  return principleDestinations(answers.agents, answers.scope, roots, claudeFile).map(({ dest }) => {
    const result = upsertPrinciples(principles.files[dest], principles.body);
    return { dest, status: result.status, text: result.text };
  });
}

function buildLegacy(answers: Answers, roots: Roots, principles: PrinciplesContext | undefined): { removals: SkillRemoval[]; notes: string[] } {
  if (!principles) return { removals: [], notes: [] };
  const folders = [...new Set(answers.agents.flatMap((agent) => foldersReadBy(agent, roots)))];
  const removals: SkillRemoval[] = [];
  const notes: string[] = [];
  for (const dest of folders.map((folder) => join(folder, LEGACY_SKILL))) {
    const files = principles.legacySkills[dest];
    if (!files) continue;
    if (legacySkillMatches(files, principles.legacy)) removals.push({ dest });
    else notes.push(`Kept ${displayPath(dest, roots)} (old coding-principles skill was edited; remove it yourself)`);
  }
  return { removals, notes };
}

export function buildPlan(answers: Answers, skills: Skill[], roots: Roots, scan: Scan, principles?: PrinciplesContext): Plan {
  const chosen = answers.skills.map((name) => skills.find((skill) => skill.name === name)).filter((s): s is Skill => !!s);
  const legacy = buildLegacy(answers, roots, principles);
  const notes = [...legacy.notes];
  if (answers.scope === "global" && answers.agents.includes("cursor")) notes.push(CURSOR_GLOBAL_NOTE);
  return {
    writes: buildWrites(answers, chosen, roots, scan),
    warnings: buildWarnings(answers, chosen, roots, scan),
    instructions: buildInstructions(answers, roots, principles),
    removals: legacy.removals,
    notes,
  };
}

export function resolveInstructions(plan: Plan, decisions: Record<string, Decision>): { dest: string; text: string }[] {
  return plan.instructions.flatMap((write) => {
    if (write.status === "new") return [{ dest: write.dest, text: write.text }];
    if (write.status === "conflict" && decisions[write.dest] === "replace") return [{ dest: write.dest, text: write.text }];
    return [];
  });
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
