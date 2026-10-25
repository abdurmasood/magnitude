import { join } from "node:path";
import { legacySkillMatches, principleDestinations, upsertPrinciples } from "./principles.js";
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

export interface PrinciplesContext {
  body: string;
  /** The bundled file `body` was read from. */
  bodyFile: string;
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

/** Copies in other folders a ticked agent reads. A missing or identical copy is silent: only "conflict" warns. */
function buildWarnings(answers: Answers, chosen: Skill[], roots: Roots, scan: Scan): DuplicateWarning[] {
  const targets = new Set(targetFolders(answers.agents).map((folder) => folderPath(folder, answers.scope, roots)));
  return [...new Set([roots.project, roots.home])].flatMap((root) =>
    ALL_FOLDERS.flatMap((key) => {
      const folder = join(root, key);
      const agents = readersOf(key, answers.agents);
      if (targets.has(folder) || agents.length === 0) return [];
      return chosen
        .filter((skill) => statusOf(scan[folder]?.[skill.name], expectedFiles(skill, key)) === "conflict")
        .map((skill) => ({ skill: skill.name, folder, agents }));
    }),
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

function buildLegacy(answers: Answers, roots: Roots, principles: PrinciplesContext | undefined): { removals: SkillRemoval[]; kept: string[] } {
  if (!principles) return { removals: [], kept: [] };
  const folders = [...new Set(answers.agents.flatMap((agent) => foldersReadBy(agent, roots)))];
  const removals: SkillRemoval[] = [];
  const kept: string[] = [];
  for (const dest of folders.map((folder) => join(folder, LEGACY_SKILL))) {
    const files = principles.legacySkills[dest];
    if (!files) continue;
    if (legacySkillMatches(files, principles.legacy)) removals.push({ dest });
    else kept.push(dest);
  }
  return { removals, kept };
}

export function buildPlan(answers: Answers, skills: Skill[], roots: Roots, scan: Scan, principles?: PrinciplesContext): Plan {
  const chosen = answers.skills.map((name) => skills.find((skill) => skill.name === name)).filter((s): s is Skill => !!s);
  const legacy = buildLegacy(answers, roots, principles);
  const instructions = buildInstructions(answers, roots, principles);
  const cursorGlobal = answers.scope === "global" && answers.agents.includes("cursor");
  return {
    writes: buildWrites(answers, chosen, roots, scan),
    warnings: buildWarnings(answers, chosen, roots, scan),
    instructions,
    removals: legacy.removals,
    kept: legacy.kept,
    cursorPrinciplesSource: cursorGlobal ? (instructions[0]?.dest ?? principles?.bodyFile) : undefined,
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
