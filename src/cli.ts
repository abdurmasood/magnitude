import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./commands/router.js";

/** dist/cli.js and src/cli.ts both sit one level below the package root; every other module gets paths from here. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.exitCode = await runCommand({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    home: homedir(),
    packageRoot,
    skillsDir: join(packageRoot, "skills"),
    interactive: process.stdin.isTTY === true,
    log: console.log,
    error: console.error,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
