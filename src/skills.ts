import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { FileMap, Skill } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Resolves the bundled skills folder relative to the built dist/cli.js (or src/skills.ts). */
export function bundledSkillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

export function readFilesRecursive(root: string, prefix = ""): FileMap {
  const files: FileMap = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, readFilesRecursive(root, relative));
    else files[relative] = readFileSync(join(root, relative), "utf8");
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
