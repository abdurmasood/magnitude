import { describe, expect, test } from "vitest";
import { parseFlags, resolveNonInteractive, UsageError } from "../src/flags.js";
import type { Flags } from "../src/flags.js";

const skills = ["calibrate", "open-pr"];
const parse = (...argv: string[]) => parseFlags(argv, skills);
const base: Flags = { command: "init", global: false, replace: false, keepExisting: false, yes: false };

describe("parseFlags", () => {
  test("parses agents list", () => {
    expect(parse("init", "--agents", "claude,codex").agents).toEqual(["claude", "codex"]);
  });

  test("trims and de-duplicates agents and skills", () => {
    expect(parse("init", "--agents", "claude, codex,claude").agents).toEqual(["claude", "codex"]);
    expect(parse("init", "--skills", " calibrate,open-pr ").skills).toEqual(["calibrate", "open-pr"]);
  });

  test("skills all", () => {
    expect(parse("init", "--skills", "all").skills).toBe("all");
  });

  test("mixing all with names is an unknown skill", () => {
    expect(() => parse("init", "--skills", "all,calibrate")).toThrow(/calibrate, open-pr/);
  });

  test("unknown agent lists valid agents", () => {
    expect(() => parse("init", "--agents", "vim")).toThrow(/claude, cursor, codex/);
  });

  test("unknown skill lists valid skills", () => {
    expect(() => parse("init", "--skills", "nope")).toThrow(/calibrate, open-pr/);
  });

  test("empty list is a usage error", () => {
    expect(() => parse("init", "--agents", " , ")).toThrow(UsageError);
  });

  test("replace with keep-existing is a usage error", () => {
    expect(() => parse("init", "--replace", "--keep-existing")).toThrow(UsageError);
  });

  test("unknown flag is a UsageError", () => {
    expect(() => parse("init", "--bogus")).toThrow(UsageError);
  });

  test("unknown command and extra positionals are usage errors", () => {
    expect(() => parse("frobnicate")).toThrow(UsageError);
    expect(() => parse("init", "extra")).toThrow(UsageError);
    expect(() => parse("update", "extra")).toThrow(UsageError);
  });

  test("update takes no options", () => {
    expect(parse("update").command).toBe("update");
    expect(() => parse("update", "--yes")).toThrow(UsageError);
  });

  test("help and version commands", () => {
    expect(parse("--help").command).toBe("help");
    expect(parse("init", "-h").command).toBe("help");
    expect(parse("--version").command).toBe("version");
    expect(parse("-v").command).toBe("version");
    expect(parse().command).toBe("help");
  });

  test("boolean flags", () => {
    const flags = parse("init", "--global", "--yes", "--replace");
    expect(flags).toMatchObject({ global: true, yes: true, replace: true, keepExisting: false });
  });

  test("UsageError has its name", () => {
    expect(new UsageError("x").name).toBe("UsageError");
  });
});

describe("resolveNonInteractive", () => {
  test("uses detected agents when none given", () => {
    expect(resolveNonInteractive(base, ["cursor"], skills).agents).toEqual(["cursor"]);
  });

  test("explicit agents win over detected", () => {
    expect(resolveNonInteractive({ ...base, agents: ["codex"] }, ["cursor"], skills).agents).toEqual(["codex"]);
  });

  test("no agents anywhere mentions --agents", () => {
    expect(() => resolveNonInteractive(base, [], skills)).toThrow(/--agents/);
  });

  test("no skills means all, in order", () => {
    expect(resolveNonInteractive(base, ["claude"], skills).skills).toEqual(skills);
    expect(resolveNonInteractive({ ...base, skills: "all" }, ["claude"], skills).skills).toEqual(skills);
  });

  test("named skills are kept", () => {
    expect(resolveNonInteractive({ ...base, skills: ["open-pr"] }, ["claude"], skills).skills).toEqual(["open-pr"]);
  });

  test("scope follows --global", () => {
    expect(resolveNonInteractive({ ...base, global: true }, ["claude"], skills).scope).toBe("global");
    expect(resolveNonInteractive(base, ["claude"], skills).scope).toBe("project");
  });
});
