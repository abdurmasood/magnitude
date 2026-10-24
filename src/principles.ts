import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFilesRecursive } from "./disk.js";
import type { AgentId, FileMap, Roots, Scope } from "./types.js";

/** Bundled instructions folder. dist/cli.js and src/principles.ts both sit one level below the package root. */
export function instructionsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "instructions");
}

export function loadPrinciplesBody(dir = instructionsDir()): string {
  return readFileSync(join(dir, "coding-principles.md"), "utf8");
}

export function loadLegacySkill(dir = instructionsDir()): FileMap {
  return readFilesRecursive(join(dir, "legacy", "coding-principles"));
}

const START = "<!-- magnitude:coding-principles -->";
const END = "<!-- /magnitude:coding-principles -->";

export const CURSOR_GLOBAL_NOTE =
  "Cursor has no global rules file. Pick This project, or paste the principles into Settings, then Rules, then User Rules.";

const CLAUDE_INSTRUCTION_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** First Claude instruction file that already exists, in the order Claude checks them. */
export function firstClaudeInstruction(project: string, isFile: (path: string) => boolean): string | undefined {
  return CLAUDE_INSTRUCTION_FILES.map((name) => join(project, ...name.split("/"))).find((path) => isFile(path));
}

export function principleDestinations(
  agents: AgentId[],
  scope: Scope,
  roots: Roots,
  existingClaudeFile: string | undefined,
): { dest: string }[] {
  if (scope === "global") {
    const dests: { dest: string }[] = [];
    if (agents.includes("claude")) dests.push({ dest: join(roots.home, ".claude", "CLAUDE.md") });
    if (agents.includes("codex")) dests.push({ dest: join(roots.home, ".codex", "AGENTS.md") });
    return dests;
  }
  const dests = [{ dest: join(roots.project, "AGENTS.md") }];
  if (agents.includes("claude") && existingClaudeFile) dests.push({ dest: existingClaudeFile });
  return dests;
}

const normalizeMap = (files: FileMap): FileMap =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text.replace(/\r\n/g, "\n")]));

export function legacySkillMatches(files: FileMap, legacy: FileMap): boolean {
  const have = normalizeMap(files);
  const want = normalizeMap(legacy);
  return Object.keys(have).length === Object.keys(want).length && Object.keys(want).every((path) => have[path] === want[path]);
}

const normalize = (text: string): string => text.replace(/\r\n/g, "\n");

/** Marker contents, without the surrounding blank lines the block adds. */
const innerOf = (body: string): string => normalize(body).replace(/^\n+/, "").replace(/\s+$/, "");

export function upsertPrinciples(existing: string | undefined, body: string): { status: "new" | "identical" | "conflict"; text: string } {
  const inner = innerOf(body);
  const block = `${START}\n${inner}\n${END}\n`;
  if (existing === undefined) return { status: "new", text: block };

  const text = normalize(existing);
  const start = text.indexOf(START);
  const endAt = start === -1 ? -1 : text.indexOf(END, start + START.length);
  if (start === -1 || endAt === -1) {
    const base = text.replace(/\s+$/, "");
    return { status: "new", text: base.length === 0 ? block : `${base}\n\n${block}` };
  }

  const have = innerOf(text.slice(start + START.length, endAt));
  if (have === inner) return { status: "identical", text: existing };

  const before = text.slice(0, start);
  const after = text.slice(endAt + END.length);
  return { status: "conflict", text: `${before}${START}\n${inner}\n${END}${after}` };
}
