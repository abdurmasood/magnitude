import { stripVTControlCharacters as plain } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  background,
  cursorBar,
  footerLine,
  foreground,
  headerLine,
  keyLabel,
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

test("the footer names the keys and says Submit continues", () => {
  const footer = plain(footerLine());
  expect(footer).toContain("↑↓");
  expect(footer).toContain("enter");
  expect(footer).toContain("Submit continues");
});

test("the Submit label keeps the same text whether focused or not", () => {
  expect(plain(submitLabel(true))).toBe(" Submit ");
  expect(plain(submitLabel(false))).toBe(" Submit ");
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
    for (const label of [keyLabel("enter"), submitLabel(false), submitLabel(true)]) {
      expect(label).not.toContain("\x1b[7m");
      expect(label).not.toContain("\x1b[2m");
    }
  });
});
