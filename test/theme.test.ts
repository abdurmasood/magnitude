import { PassThrough } from "node:stream";
import { stripVTControlCharacters as plain } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  background,
  canAnimate,
  cursorBar,
  footerLine,
  foreground,
  headerLine,
  keyLabel,
  riseFrames,
  setColorDepth,
  STEPS,
  stepperLine,
  submitLabel,
} from "../src/theme.js";

afterEach(() => setColorDepth(undefined));

test("the header names the tool and the agents", () => {
  expect(plain(headerLine())).toBe("▁▃▅▇ magnitude   skills for Claude Code, Cursor and Codex");
});

test("the stepper marks earlier steps done, the current one active and later ones open", () => {
  expect(plain(stepperLine(2))).toBe("✓ agents ── ✓ location ── ● skills ── ○ review");
  expect(plain(stepperLine(0))).toBe("● agents ── ○ location ── ○ skills ── ○ review");
});

test("a step past the last marks every step done", () => {
  expect(plain(stepperLine(STEPS.length))).toBe("✓ agents ── ✓ location ── ✓ skills ── ✓ review");
});

test("the footer names the section keys, the option keys, and enter", () => {
  const footer = plain(footerLine());
  expect(footer).toContain("←→");
  expect(footer).toContain("section");
  expect(footer).toContain("↑↓");
  expect(footer).toContain("option");
  expect(footer).toContain("enter");
  expect(footer).toContain("select");
});

test("the Submit label keeps the same text whether focused or not", () => {
  expect(plain(submitLabel(true))).toBe(" Submit ");
  expect(plain(submitLabel(false))).toBe(" Submit ");
  expect(plain(submitLabel(true, false))).toBe(" Submit ");
});

test("the cursor bar keeps rows aligned", () => {
  expect(plain(cursorBar(true))).toBe("▌ ");
  expect(cursorBar(false)).toBe("  ");
});

describe("colors follow the terminal's color depth", () => {
  test("24-bit uses the exact palette", () => {
    setColorDepth(24);
    expect(foreground("magenta", "x")).toBe("\x1b[38;2;214;144;227mx\x1b[39m");
    expect(background("key", "x")).toBe("\x1b[48;2;52;56;61mx\x1b[49m");
  });

  test("8-bit uses the nearest 256-color entries", () => {
    setColorDepth(8);
    expect(foreground("magenta", "x")).toBe("\x1b[38;5;177mx\x1b[39m");
    expect(background("key", "x")).toBe("\x1b[48;5;237mx\x1b[49m");
  });

  test("4-bit uses the bright named colors", () => {
    setColorDepth(4);
    expect(foreground("magenta", "x")).toBe("\x1b[95mx\x1b[39m");
    expect(background("key", "x")).toBe("\x1b[100mx\x1b[49m");
  });

  test("no color depth leaves the text plain", () => {
    setColorDepth(1);
    expect(foreground("magenta", "x")).toBe("x");
    expect(background("key", "x")).toBe("x");
    expect(keyLabel("enter")).toBe(" enter ");
  });

  test("labels never use inverse or dim", () => {
    setColorDepth(24);
    for (const label of [keyLabel("enter"), submitLabel(false), submitLabel(true), submitLabel(true, false)]) {
      expect(label).not.toContain("\x1b[7m");
      expect(label).not.toContain("\x1b[2m");
    }
  });
});

test("the header lights one bar per step reached and leaves later bars flat", () => {
  expect(plain(headerLine(0))).toBe("▁▁▁▁ magnitude   skills for Claude Code, Cursor and Codex");
  expect(plain(headerLine(2)).slice(0, 4)).toBe("▁▃▅▁");
  expect(plain(headerLine(2, 2)).slice(0, 4)).toBe("▁▃▂▁");
});

test("unlit bars are gray and lit bars are the brand purple", () => {
  setColorDepth(24);
  const header = headerLine(1);
  expect(header).toContain("\x1b[38;2;214;144;227m▃\x1b[39m");
  expect(header).toContain("\x1b[38;2;85;91;97m▁\x1b[39m");
});

test("a rising bar overshoots by one notch and settles on its height", () => {
  expect(riseFrames(1)).toEqual([1, 2, 3, 4, 3]);
  expect(STEPS.map((_, step) => riseFrames(step).at(-1))).toEqual([1, 3, 5, 7]);
});

describe("canAnimate", () => {
  const tty = Object.assign(new PassThrough(), { isTTY: true });
  const saved = process.env.CI;
  beforeEach(() => delete process.env.CI);
  afterEach(() => {
    if (saved === undefined) delete process.env.CI;
    else process.env.CI = saved;
  });

  test("animates on a terminal with 256 colors or more", () => {
    setColorDepth(8);
    expect(canAnimate(tty)).toBe(true);
  });
  test("stays still when output is not a terminal", () => {
    setColorDepth(24);
    expect(canAnimate(new PassThrough())).toBe(false);
  });
  test("stays still with 16 colors", () => {
    setColorDepth(4);
    expect(canAnimate(tty)).toBe(false);
  });
  test("stays still in CI", () => {
    setColorDepth(24);
    process.env.CI = "true";
    expect(canAnimate(tty)).toBe(false);
  });
});
