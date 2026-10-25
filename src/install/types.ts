export type AgentId = "claude" | "cursor" | "codex";
export type Scope = "project" | "global";
export type FolderKey = ".claude/skills" | ".agents/skills" | ".cursor/skills";
export type FileMap = Record<string, string>; // posix relative path -> utf8 content

export interface Skill { name: string; description: string; manualOnly: boolean; files: FileMap }
export interface Answers { agents: AgentId[]; scope: Scope; skills: string[] }
export interface Roots { project: string; home: string }
/** absolute folder path -> skill name -> its files */
export type Scan = Record<string, Record<string, FileMap>>;

export type WriteStatus = "new" | "identical" | "conflict";
export interface SkillWrite { skill: string; folder: string; dest: string; files: FileMap; status: WriteStatus; readers: AgentId[] }
export interface DuplicateWarning { skill: string; folder: string; agents: AgentId[] }
export interface InstructionWrite { dest: string; status: WriteStatus; text: string }
export interface SkillRemoval { dest: string }
export interface Plan {
  writes: SkillWrite[];
  warnings: DuplicateWarning[];
  instructions: InstructionWrite[];
  removals: SkillRemoval[];
  /** Absolute dests of edited legacy coding-principles skills left on disk. */
  kept: string[];
  /** Global + Cursor only: where to copy the principles from, since Cursor has no global rules file. */
  cursorPrinciplesSource?: string;
}
export type Decision = "replace" | "keep";
export interface FinalWrite { dest: string; files: FileMap; mode: "create" | "replace" }
