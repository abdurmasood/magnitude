import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { FileMap, Skill } from "./types.js";

/** The name becomes a destination folder, so it must be a plain, safe path segment. */
const SKILL_NAME = /^[a-z0-9-]+$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Resolves the bundled skills folder relative to the built dist/cli.js (or src/skills.ts). */
export function bundledSkillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

const MISSING_CODES = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);

/** True for errors meaning "nothing usable is there": missing entry, broken or looping symlink. */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && MISSING_CODES.has((error as NodeJS.ErrnoException).code ?? "");
}

export function readFilesRecursive(root: string, prefix = ""): FileMap {
  const files: FileMap = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(root, relative);
    let stats;
    try {
      stats = statSync(full); // follows symlinks
    } catch (error) {
      if (isMissing(error)) continue; // broken or looping symlink
      throw error;
    }
    if (stats.isDirectory()) Object.assign(files, readFilesRecursive(root, relative));
    else if (stats.isFile()) files[relative] = readFileSync(full, "utf8");
  }
  return files;
}

function parseSkill(folder: string, dir: string): Skill {
  const files = readFilesRecursive(dir);
  const skillMd = files["SKILL.md"];
  if (skillMd === undefined) throw new Error(`Skill "${folder}": missing SKILL.md`);
  const match = FRONTMATTER.exec(skillMd);
  if (!match) throw new Error(`Skill "${folder}": SKILL.md has no frontmatter block`);
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Skill "${folder}": invalid frontmatter YAML: ${reason}`);
  }
  const fields = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const { name, description } = fields;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(`Skill "${folder}": frontmatter is missing "name"`);
  }
  if (name !== folder || !SKILL_NAME.test(name)) {
    throw new Error(`Skill "${folder}": frontmatter name "${name}" must equal the folder name and match ${SKILL_NAME}`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`Skill "${folder}": frontmatter is missing "description"`);
  }
  return { name, description, manualOnly: fields["disable-model-invocation"] === true, files };
}

export function loadSkills(skillsDir: string): Skill[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseSkill(entry.name, join(skillsDir, entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
