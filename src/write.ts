import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { AgentId, FinalWrite, Plan, Roots, SkillRemoval } from "./types.js";

export const AGENT_NAMES: Record<AgentId, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };

export function applyFileWrites(writes: { dest: string; text: string }[]): void {
  for (const write of writes) {
    mkdirSync(dirname(write.dest), { recursive: true });
    writeFileSync(write.dest, write.text, "utf8");
  }
}

/** Unlinks the path itself. A symlink is removed without following it into the target. */
export function applyRemovals(dests: string[]): void {
  for (const dest of dests) rmSync(dest, { recursive: true, force: true });
}

export function applyWrites(writes: FinalWrite[]): void {
  for (const write of writes) {
    // rmSync unlinks a symlink itself and never follows it into the target.
    if (write.mode === "replace") rmSync(write.dest, { recursive: true, force: true });
    for (const [path, text] of Object.entries(write.files)) {
      const file = join(write.dest, ...path.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text, "utf8");
    }
  }
}

/** Project paths relative to the project root, home paths under `~`, anything else unchanged. */
export function displayPath(path: string, roots: Roots): string {
  if (path.startsWith(roots.project + sep)) return relative(roots.project, path).split(sep).join("/");
  if (path.startsWith(roots.home + sep)) return `~/${relative(roots.home, path).split(sep).join("/")}`;
  return path;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function reviewLines(
  plan: Plan,
  writes: FinalWrite[],
  roots: Roots,
  files: { dest: string }[] = [],
  removals: SkillRemoval[] = [],
): string[] {
  const written = new Set(writes.map((write) => write.dest));
  const folders = new Map<string, { skills: number; readers: AgentId[] }>();
  for (const planned of plan.writes) {
    if (!written.has(planned.dest)) continue;
    const entry = folders.get(planned.folder) ?? { skills: 0, readers: planned.readers };
    entry.skills += 1;
    folders.set(planned.folder, entry);
  }
  const lines = [...folders].map(([folder, { skills, readers }]) => {
    const names = readers.map((agent) => AGENT_NAMES[agent]).join(", ");
    return `${displayPath(folder, roots)}: ${plural(skills, "skill")}, read by ${names}`;
  });
  const instructionLines = files.map((file) => `${displayPath(file.dest, roots)}: coding principles`);
  const removalLines = removals.map((removal) => `remove ${displayPath(removal.dest, roots)}`);
  const fileCount = writes.reduce((sum, write) => sum + Object.keys(write.files).length, 0) + files.length;
  return [...lines, ...instructionLines, ...removalLines, `${plural(fileCount, "file")} total`];
}

export function nextStepLines(agents: AgentId[], skills: string[]): string[] {
  const skill = skills.includes("calibrate") ? "calibrate" : skills[0];
  const slash = (["claude", "cursor"] as const).filter((agent) => agents.includes(agent));
  const lines: string[] = [];
  if (slash.length > 0) lines.push(`${slash.map((agent) => AGENT_NAMES[agent]).join(" / ")}: /${skill}`);
  if (agents.includes("codex")) lines.push(`Codex: $${skill}`);
  return lines;
}
