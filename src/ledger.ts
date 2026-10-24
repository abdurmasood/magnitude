import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMissing } from "./disk.js";

export interface RecordedSkill {
  name: string;
  dest: string;
}

export interface InstallRecord {
  root: string;
  skills: RecordedSkill[];
}

export interface Ledger {
  installs: InstallRecord[];
}

export const ledgerPath = (home: string): string => join(home, ".magnitude", "installs.json");

export function readLedger(home: string): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(home), "utf8")) as Partial<Ledger>;
    if (!Array.isArray(parsed.installs)) return { installs: [] };
    return { installs: parsed.installs };
  } catch (error) {
    if (isMissing(error)) return { installs: [] };
    throw error;
  }
}

/** Adds dests for one root. A later init keeps dests from an earlier run. */
export function recordInstalls(home: string, root: string, skills: RecordedSkill[]): void {
  if (skills.length === 0) return;
  const ledger = readLedger(home);
  const existing = ledger.installs.find((entry) => entry.root === root);
  const merged = dedupe([...(existing?.skills ?? []), ...skills]);
  if (existing) existing.skills = merged;
  else ledger.installs.push({ root, skills: merged });
  const path = ledgerPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function dedupe(skills: RecordedSkill[]): RecordedSkill[] {
  const byDest = new Map<string, RecordedSkill>();
  for (const skill of skills) byDest.set(skill.dest, skill);
  return [...byDest.values()].sort((a, b) => a.dest.localeCompare(b.dest));
}
