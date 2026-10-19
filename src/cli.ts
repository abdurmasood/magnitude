import { homedir } from "node:os";
import { runInit } from "./init.js";
import { bundledSkillsDir } from "./skills.js";

try {
  process.exitCode = await runInit({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    home: homedir(),
    skillsDir: bundledSkillsDir(),
    interactive: process.stdin.isTTY === true,
    log: console.log,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
