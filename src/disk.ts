import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FileMap } from "./types.js";

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
