import { PassThrough } from "node:stream";
import { stripVTControlCharacters as plain } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  initialPickerState,
  pick,
  renderPicker,
  stepPicker,
  type PickerKey,
  type PickerOption,
  type PickerState,
} from "../src/picker.js";
import { RISE_FRAME_MS, setColorDepth } from "../src/theme.js";

const agents: PickerOption<string>[] = [
  { value: "claude", label: "Claude Code", hint: "found .claude/" },
  { value: "cursor", label: "Cursor", hint: "found .cursor/" },
  { value: "codex", label: "Codex", hint: "found .agents/" },
];

const scope: PickerOption<string>[] = [
  { value: "project", label: "This project", hint: "shared with the team via git" },
  { value: "global", label: "Global", hint: "every project on this machine" },
];

const press = <T>(state: PickerState<T>, key: PickerKey, options: PickerOption<T>[], multiple: boolean, required: boolean) =>
  stepPicker(state, key, options, multiple, required);

test("initial selection follows option order", () => {
  expect(initialPickerState(agents, ["codex", "claude"], true).selected).toEqual(["claude", "codex"]);
});

test("a chosen answer starts highlighted on Submit", () => {
  expect(initialPickerState(scope, ["global"], false).cursor).toBe(scope.length);
  expect(initialPickerState(agents, ["codex"], true).cursor).toBe(agents.length);
});

test("nothing chosen starts on the first option", () => {
  expect(initialPickerState(agents, [], true).cursor).toBe(0);
});

test("arrows move the highlight and leave the selection alone", () => {
  const start = initialPickerState(agents, ["claude", "cursor"], true);
  const up = press(start, "up", agents, true, true);
  expect(up.done).toBe(false);
  expect(up.state.cursor).toBe(agents.length - 1);
  expect(up.state.selected).toEqual(["claude", "cursor"]);
  expect(press(start, "down", agents, true, true).state.cursor).toBe(agents.length);
});

test("arrows stop at the ends", () => {
  let state = initialPickerState(agents, ["claude"], true);
  expect(press(state, "down", agents, true, true).state.cursor).toBe(agents.length);
  for (let i = 0; i < 6; i++) state = press(state, "up", agents, true, true).state;
  expect(state.cursor).toBe(0);
  expect(press(state, "up", agents, true, true).state.cursor).toBe(0);
});

test("enter toggles a multi-select option and a second enter clears it", () => {
  let start = initialPickerState(agents, ["claude"], true);
  for (let i = 0; i < agents.length; i++) start = press(start, "up", agents, true, true).state;
  const cleared = press(start, "enter", agents, true, true);
  expect(cleared.done).toBe(false);
  expect(cleared.state.selected).toEqual([]);
  expect(press(cleared.state, "enter", agents, true, true).state.selected).toEqual(["claude"]);
});

test("selecting out of order still stores option order", () => {
  let state = initialPickerState(agents, [], true);
  state = press(state, "down", agents, true, true).state;
  state = press(state, "down", agents, true, true).state;
  state = press(state, "enter", agents, true, true).state;
  state = press(state, "up", agents, true, true).state;
  state = press(state, "up", agents, true, true).state;
  state = press(state, "enter", agents, true, true).state;
  expect(state.selected).toEqual(["claude", "codex"]);
});

test("enter on a single choice moves the selection and cannot clear it", () => {
  let state = initialPickerState(scope, ["project"], false);
  state = press(state, "up", scope, false, false).state;
  const moved = press(state, "enter", scope, false, false);
  expect(moved.done).toBe(false);
  expect(moved.state.selected).toEqual(["global"]);
  expect(press(moved.state, "enter", scope, false, false).state.selected).toEqual(["global"]);
});

test("moving onto a single choice does not select it", () => {
  let state = initialPickerState(scope, ["project"], false);
  state = press(state, "up", scope, false, false).state;
  expect(state.selected).toEqual(["project"]);
  state = press(state, "down", scope, false, false).state;
  const done = press(state, "enter", scope, false, false);
  expect(state.cursor).toBe(scope.length);
  expect(done.done).toBe(true);
  expect(done.state.selected).toEqual(["project"]);
});

test("space changes nothing", () => {
  const start = initialPickerState(agents, ["claude"], true);
  const next = press(start, "space", agents, true, true);
  expect(next.done).toBe(false);
  expect(next.state).toEqual(start);
});

test("submit with nothing selected stays put", () => {
  let state = initialPickerState(agents, [], true);
  for (let i = 0; i < agents.length; i++) state = press(state, "down", agents, true, true).state;
  const blocked = press(state, "enter", agents, true, true);
  expect(blocked.done).toBe(false);
  expect(blocked.state.cursor).toBe(agents.length);
  expect(blocked.state.selected).toEqual([]);
  expect(blocked.state.notice).toBe("Choose at least one.");
});

const plainLines = (frame: string) => plain(frame).split("\n");

test("the active frame shows the header, the stepper, the highlight, the marks, and Submit", () => {
  const state = initialPickerState(agents, ["claude", "cursor"], true);
  const frame = renderPicker({ message: "Which agents do you use?", options: agents, state, multiple: true, phase: "active", step: 0, columns: 80 });
  const lines = plainLines(frame);
  expect(lines[0]).toBe("▁▁▁▁ magnitude   skills for Claude Code, Cursor and Codex");
  expect(lines[2]).toBe("● agents ── ○ location ── ○ skills ── ○ review");
  expect(lines).toContain("Which agents do you use?");
  expect(lines).toContain("  ■ Claude Code   found .claude/");
  expect(lines).toContain("  ■ Cursor        found .cursor/");
  expect(lines).toContain("  □ Codex         found .agents/");
  expect(lines).toContain("▌  Submit ");
  expect(lines[lines.length - 1]).toContain("Submit continues");
  const blocked = press({ ...state, cursor: agents.length, selected: [] }, "enter", agents, true, true);
  const error = plainLines(
    renderPicker({ message: "Which agents do you use?", options: agents, state: blocked.state, multiple: true, phase: "active", step: 0, columns: 80 }),
  );
  expect(error).toContain("▌  Submit ");
  expect(error).toContain("  Choose at least one.");
});

test("a single choice uses a radio mark", () => {
  const frame = renderPicker({
    message: "Where should the skills go?",
    options: scope,
    state: initialPickerState(scope, ["project"], false),
    multiple: false,
    phase: "active",
    step: 1,
    columns: 80,
  });
  expect(frame).toContain("●");
  expect(frame).toContain("○");
  expect(frame).not.toContain("■");
  expect(plain(frame)).toContain("✓ agents ── ● location");
});

test("a hint that does not fit the terminal is dropped", () => {
  const state = initialPickerState(scope, ["project"], false);
  const lines = plainLines(renderPicker({ message: "Where?", options: scope, state, multiple: false, phase: "active", step: 1, columns: 47 }));
  expect(lines).toContain("  ● This project   shared with the team via git");
  expect(lines).toContain("  ○ Global");
});

test("body lines sit under the message", () => {
  const state = initialPickerState(scope, ["project"], false);
  const lines = plainLines(
    renderPicker({ message: "Write 2 files?", body: ["", "  AGENTS.md  coding principles"], options: scope, state, multiple: false, phase: "active", step: 3 }),
  );
  const at = lines.indexOf("Write 2 files?");
  expect(lines.slice(at, at + 4)).toEqual(["Write 2 files?", "", "  AGENTS.md  coding principles", ""]);
});

test("the submit and cancel frames are empty", () => {
  const state = initialPickerState(agents, ["cursor", "claude"], true);
  const spec = { message: "Which agents do you use?", options: agents, state, multiple: true, step: 0 };
  expect(renderPicker({ ...spec, phase: "submit" })).toBe("");
  expect(renderPicker({ ...spec, phase: "cancel" })).toBe("");
});

test("pick moves back over the line clack leaves after an empty frame", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => (written += chunk.toString()));
  const answer = pick({ message: "Where?", options: scope, initial: ["project"], multiple: false, step: 1, input, output });
  input.write("\x1b[B");
  input.write("\x1b[B");
  input.write("\r");
  expect(await answer).toEqual(["project"]);
  await new Promise((done) => setImmediate(done));
  // After erasing the frame, clack writes exactly one newline; pick then moves back up over it.
  const tail = written.slice(written.lastIndexOf("\x1b[J"));
  expect(tail.split("\n")).toHaveLength(2);
  expect(tail.endsWith("\x1b[1A")).toBe(true);
});

describe("the current step's bar rises on a terminal", () => {
  const savedCI = process.env.CI;
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const SETTLED = RISE_FRAME_MS * 8;

  beforeEach(() => {
    delete process.env.CI;
    setColorDepth(24);
  });
  afterEach(() => {
    setColorDepth(undefined);
    if (savedCI === undefined) delete process.env.CI;
    else process.env.CI = savedCI;
  });

  function terminal() {
    const input = new PassThrough();
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const seen = { written: "" };
    output.on("data", (chunk: Buffer) => (seen.written += chunk.toString()));
    return { input, output, seen };
  }

  test("draws each height on the way up, then settles", async () => {
    const { input, output, seen } = terminal();
    const answer = pick({ message: "Where?", options: scope, initial: ["project"], multiple: false, step: 1, input, output });
    await wait(SETTLED);
    const text = plain(seen.written);
    for (const bars of ["▁▁▁▁", "▁▂▁▁", "▁▃▁▁", "▁▄▁▁"]) expect(text).toContain(`${bars} magnitude`);
    expect(text.lastIndexOf("▁▃▁▁ magnitude")).toBeGreaterThan(text.lastIndexOf("▁▄▁▁ magnitude"));
    input.write("\x1b[B\x1b[B\r");
    expect(await answer).toEqual(["project"]);
  });

  test("submitting mid-rise leaves nothing drawn after the erased frame", async () => {
    const { input, output, seen } = terminal();
    const answer = pick({ message: "Where?", options: scope, initial: ["project"], multiple: false, step: 3, input, output });
    input.write("\x1b[B\x1b[B\r");
    expect(await answer).toEqual(["project"]);
    await wait(SETTLED);
    expect(plain(seen.written)).not.toContain("▁▃▅█ magnitude");
    expect(seen.written.endsWith("\x1b[1A")).toBe(true);
  });

  test("a repeat question on the same step shows the bar already up", async () => {
    const { input, output, seen } = terminal();
    const answer = pick({ message: "Where?", options: scope, initial: ["project"], multiple: false, step: 1, rise: false, input, output });
    await wait(SETTLED);
    const text = plain(seen.written);
    expect(text).toContain("▁▃▁▁ magnitude");
    expect(text).not.toContain("▁▄▁▁ magnitude");
    input.write("\x1b[B\x1b[B\r");
    expect(await answer).toEqual(["project"]);
  });
});
