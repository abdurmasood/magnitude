import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMissing } from "./disk.js";
import { readLedger } from "./ledger.js";
import { expectedFiles } from "./plan.js";
import { loadSkills } from "./skills.js";
import type { FileMap, FolderKey } from "./types.js";

export type Manager = "npm" | "pnpm" | "bun";

export const NOT_GLOBAL = "Magnitude is not installed globally. Install it with npm, pnpm, or bun, then run magnitude update.";
export const NONE_RECORDED = "No projects are recorded. Run magnitude init in a project to record one.";
export const alreadyLatest = (version: string): string => `You are already on the latest version (${version}).`;

const PACKAGE = "@magnitudeai/cli@latest";
const REGISTRY = "https://registry.npmjs.org/@magnitudeai/cli/latest";
const FOLDERS: FolderKey[] = [".claude/skills", ".agents/skills", ".cursor/skills"];

/** Set on the process that refreshes skills after the package is reinstalled. */
export const APPLY_ENV = "MAGNITUDE_UPDATE_APPLY";

export interface UpdateHooks {
  packagePath: string;
  currentVersion?: string;
  latest: () => Promise<string>;
  install: (bin: string, args: string[]) => Promise<void>;
  apply: () => Promise<number>;
  hasPackageJson?: (dir: string) => boolean;
}

export interface UpdateIO {
  packagePath: string;
  currentVersion: string;
  latest: () => Promise<string>;
  install: (bin: string, args: string[]) => Promise<void>;
  apply: () => Promise<number>;
  hasPackageJson: (dir: string) => boolean;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The running file. A global install lives under that package manager's prefix. */
export function currentPackagePath(): string {
  return realpathSync(fileURLToPath(import.meta.url));
}

export function defaultHasPackageJson(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

/**
 * First match wins. A project install has package.json beside node_modules.
 * npx, a source checkout, and anything else are not a global install.
 */
export function detectManager(packagePath: string, hasPackageJson: (dir: string) => boolean): Manager | null {
  const normalized = packagePath.split("\\").join("/");
  if (normalized.includes("_npx")) return null;
  if (normalized.includes("pnpm/global")) return "pnpm";
  if (normalized.includes(".bun/install/global")) return "bun";
  const marker = "/node_modules/@magnitudeai/cli";
  const index = normalized.lastIndexOf(marker);
  if (index <= 0) return null;
  if (hasPackageJson(normalized.slice(0, index))) return null;
  return "npm";
}

export function installCommand(manager: Manager): { bin: string; args: string[] } {
  if (manager === "npm") return { bin: "npm", args: ["install", "-g", PACKAGE] };
  return { bin: manager, args: ["add", "-g", PACKAGE] };
}

export async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(REGISTRY);
  if (!response.ok) throw new Error(`Could not check the latest version (${response.status}).`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string" || body.version.trim() === "") {
    throw new Error("Could not check the latest version.");
  }
  return body.version.trim();
}

export async function runUpdate(io: UpdateIO): Promise<number> {
  const manager = detectManager(io.packagePath, io.hasPackageJson);
  if (manager === null) {
    io.error(NOT_GLOBAL);
    return 1;
  }
  let latest: string;
  try {
    latest = (await io.latest()).trim();
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (latest === io.currentVersion) {
    io.log(alreadyLatest(io.currentVersion));
    return 0;
  }
  const command = installCommand(manager);
  try {
    await io.install(command.bin, command.args);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  try {
    return await io.apply();
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** Writes shipped skill files into dests that already exist. Other files stay. */
export function applyRecordedSkills(home: string, skillsDir: string, log: (line: string) => void): number {
  const ledger = readLedger(home);
  if (ledger.installs.length === 0) {
    log(NONE_RECORDED);
    return 0;
  }
  const byName = new Map(loadSkills(skillsDir).map((skill) => [skill.name, skill]));
  for (const entry of ledger.installs) {
    for (const recorded of entry.skills) {
      const skill = byName.get(recorded.name);
      const folder = folderKeyOf(recorded.dest);
      if (!skill || !folder || !isDirectory(recorded.dest)) continue;
      writeFiles(recorded.dest, expectedFiles(skill, folder));
    }
  }
  return 0;
}

export function folderKeyOf(dest: string): FolderKey | undefined {
  const normalized = dest.split("\\").join("/");
  return FOLDERS.find((folder) => normalized.includes(`/${folder}/`));
}

function writeFiles(dest: string, files: FileMap): void {
  for (const [path, text] of Object.entries(files)) {
    const file = join(dest, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** pnpm's real package directory changes on upgrade, so refresh runs in a new process. */
export function reexecApply(): Promise<number> {
  return runProcess("magnitude", ["update"], { ...process.env, [APPLY_ENV]: "1" });
}

export function installPackage(bin: string, args: string[]): Promise<void> {
  return runProcess(bin, args, process.env).then((code) => {
    if (code !== 0) throw new Error(`${bin} ${args.join(" ")} failed`);
  });
}

function runProcess(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(bin, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    });
  });
}
