import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileMap, FinalWrite } from "./types.js";

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
