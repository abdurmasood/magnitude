import { stdout } from "node:process";
import type { Key } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import { getColumns, isCancel, Prompt } from "@clack/core";
import {
  canAnimate,
  cursorBar,
  footerLine,
  foreground,
  headerLine,
  RISE_FRAME_MS,
  riseFrames,
  type Step,
  stepperLine,
  submitLabel,
} from "./theme.js";

export interface PickerOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface PickerState<T> {
  cursor: number;
  selected: T[];
  notice: string;
}

export type PickerKey = "up" | "down" | "enter" | "space";

export interface PickerStep<T> {
  state: PickerState<T>;
  done: boolean;
}

const REQUIRED = "Choose at least one.";

function chosen<T>(options: PickerOption<T>[], selected: readonly T[]): T[] {
  return options.filter((option) => selected.includes(option.value)).map((option) => option.value);
}

function seed<T>(options: PickerOption<T>[], initial: readonly T[], multiple: boolean): T[] {
  const selected = chosen(options, initial);
  if (multiple) return selected;
  if (selected.length > 0) return [selected[0]];
  return options[0] === undefined ? [] : [options[0].value];
}

export function initialPickerState<T>(
  options: PickerOption<T>[],
  initial: readonly T[],
  multiple: boolean,
): PickerState<T> {
  const selected = seed(options, initial, multiple);
  // A chosen answer starts on Submit, so Enter confirms it. An empty list starts on the first row.
  const cursor = selected.length > 0 ? options.length : 0;
  return { cursor, selected, notice: "" };
}

export interface WizardState<T> {
  index: number;
  pages: PickerState<T>[];
}

export interface WizardStep<T> {
  state: WizardState<T>;
  done: boolean;
  back: boolean;
}

export interface WizardRules<T> {
  options: PickerOption<T>[];
  multiple: boolean;
  required: boolean;
}

interface WizardSeed<T> {
  options: PickerOption<T>[];
  initial: readonly T[];
  multiple: boolean;
}

export function initialWizardState<T>(pages: WizardSeed<T>[], startIndex = 0): WizardState<T> {
  const last = Math.max(0, pages.length - 1);
  return {
    index: Math.min(Math.max(0, startIndex), last),
    pages: pages.map((page) => initialPickerState(page.options, page.initial, page.multiple)),
  };
}

function writePage<T>(state: WizardState<T>, page: PickerState<T>): WizardState<T> {
  const pages = state.pages.map((item, index) => (index === state.index ? page : item));
  return { ...state, pages };
}

/** Left and right change page. Up, down, and enter stay on the current page until Submit moves on. */
export function stepWizard<T>(
  state: WizardState<T>,
  key: PickerKey | "left" | "right",
  pages: WizardRules<T>[],
  opts: { allowBack: boolean; rightOnLast: "stop" | "done" },
): WizardStep<T> {
  const stay = (next: WizardState<T>): WizardStep<T> => ({ state: next, done: false, back: false });
  const page = pages[state.index];
  const current = state.pages[state.index];
  if (key === "left") {
    if (state.index === 0) return opts.allowBack ? { state, done: false, back: true } : stay(state);
    return stay({ ...writePage(state, { ...current, notice: "" }), index: state.index - 1 });
  }
  if (key === "right") {
    if (page.required && current.selected.length === 0) return stay(writePage(state, { ...current, notice: REQUIRED }));
    const cleared = writePage(state, { ...current, notice: "" });
    if (state.index === pages.length - 1) return opts.rightOnLast === "done" ? { state: cleared, done: true, back: false } : stay(cleared);
    return stay({ ...cleared, index: state.index + 1 });
  }
  const stepped = stepPicker(current, key, page.options, page.multiple, page.required);
  if (!stepped.done) return stay(writePage(state, stepped.state));
  const cleared = writePage(state, stepped.state);
  if (state.index === pages.length - 1) return { state: cleared, done: true, back: false };
  return stay({ ...cleared, index: state.index + 1 });
}

/** Arrow keys move. Enter toggles. Enter on the Submit row finishes, unless a required list is empty. */
export function stepPicker<T>(
  state: PickerState<T>,
  key: PickerKey,
  options: PickerOption<T>[],
  multiple: boolean,
  required: boolean,
): PickerStep<T> {
  if (key === "space") return { state, done: false };
  const submitAt = options.length;
  if (key === "up") return { state: { ...state, cursor: Math.max(0, state.cursor - 1), notice: "" }, done: false };
  if (key === "down") return { state: { ...state, cursor: Math.min(submitAt, state.cursor + 1), notice: "" }, done: false };
  if (state.cursor === submitAt) {
    if (required && state.selected.length === 0) return { state: { ...state, notice: REQUIRED }, done: false };
    return { state: { ...state, notice: "" }, done: true };
  }
  const value = options[state.cursor].value;
  const selected = multiple
    ? chosen(options, state.selected.includes(value) ? state.selected.filter((item) => item !== value) : [...state.selected, value])
    : [value];
  return { state: { ...state, selected, notice: "" }, done: false };
}

interface Row {
  active: boolean;
  selected: boolean;
  multiple: boolean;
}

function mark(row: Row): string {
  const symbol = row.multiple ? (row.selected ? "■" : "□") : row.selected ? "●" : "○";
  return row.selected ? foreground("magenta", symbol) : styleText("dim", symbol);
}

/** `hintAt` is the column every hint starts at. A hint that would run past `columns` is dropped. */
function optionLine<T>(option: PickerOption<T>, row: Row, hintAt: number, columns: number): string {
  const label = row.active ? styleText("bold", option.label) : option.label;
  const head = `${cursorBar(row.active)}${mark(row)} ${label}`;
  if (option.hint === undefined || hintAt + option.hint.length > columns) return head;
  const width = `▌ ■ ${option.label}`.length;
  return `${head}${" ".repeat(hintAt - width)}${styleText("dim", option.hint)}`;
}

export interface RenderInput<T> {
  message: string;
  options: PickerOption<T>[];
  state: PickerState<T>;
  multiple: boolean;
  phase: "active" | "submit" | "cancel";
  step: Step;
  /** Lines under the message, already styled. */
  body?: string[];
  columns?: number;
  /** Height of the current step's bar while it rises; undefined once it has settled. */
  riseHeight?: number;
}

function optionLines<T>(input: RenderInput<T>): string[] {
  const hintAt = `▌ ■ `.length + Math.max(0, ...input.options.map((option) => option.label.length)) + 3;
  return input.options.map((option, index) =>
    optionLine(
      option,
      { active: index === input.state.cursor, selected: input.state.selected.includes(option.value), multiple: input.multiple },
      hintAt,
      input.columns ?? 80,
    ),
  );
}

/** Submit and cancel render nothing, so a finished question leaves no frame behind. */
export function renderPicker<T>(input: RenderInput<T>): string {
  if (input.phase !== "active") return "";
  const onSubmit = input.state.cursor === input.options.length;
  const lines = [headerLine(input.step, input.riseHeight), "", stepperLine(input.step), "", styleText("bold", input.message), ...(input.body ?? []), ""];
  lines.push(...optionLines(input), "", `${cursorBar(onSubmit)}${submitLabel(onSubmit)}`);
  if (input.state.notice !== "") lines.push(foreground("yellow", `  ${input.state.notice}`));
  lines.push("", footerLine());
  return lines.join("\n");
}

interface Held<T> {
  state: PickerState<T>;
  riseHeight?: number;
}

interface PickOptions<T> {
  message: string;
  options: PickerOption<T>[];
  initial: readonly T[];
  multiple: boolean;
  step: Step;
  body?: string[];
  required?: boolean;
  /** Animate the current step's bar rising. Off for repeat questions on the same step. Defaults to true. */
  rise?: boolean;
  input?: Readable;
  output?: Writable;
}

class ListPrompt<T> extends Prompt<T[]> {
  private cursor: number;
  private readonly submitAt: number;
  private readonly spec: PickOptions<T>;
  private readonly held: Held<T>;
  private riseTimer: NodeJS.Timeout | undefined;

  constructor(spec: PickOptions<T>, held: Held<T>, required: boolean) {
    super(
      {
        input: spec.input,
        output: spec.output,
        validate(value) {
          if (required && (value === undefined || value.length === 0)) return REQUIRED;
        },
        render() {
          const phase = this.state === "submit" ? "submit" : this.state === "cancel" ? "cancel" : "active";
          const notice = this.state === "error" && this.error !== "" ? this.error : held.state.notice;
          return renderPicker({
            message: spec.message,
            options: spec.options,
            state: { ...held.state, notice },
            multiple: spec.multiple,
            phase,
            step: spec.step,
            body: spec.body,
            columns: getColumns(spec.output ?? stdout),
            riseHeight: held.riseHeight,
          });
        },
      },
      false,
    );
    this.submitAt = spec.options.length;
    this.cursor = held.state.cursor;
    this.spec = spec;
    this.held = held;
    // Clack submits on Return after this listener. Only the Submit row may submit.
    this.on("key", (_char, key) => {
      const mapped = toKey(key);
      if (mapped === null) return;
      const next = stepPicker(held.state, mapped, spec.options, spec.multiple, required);
      held.state = next.state;
      this.cursor = next.state.cursor;
      if (next.done) this.value = [...next.state.selected];
    });
  }

  protected _shouldSubmit(_char: string | undefined, _key: Key): boolean {
    return this.cursor === this.submitAt;
  }

  prompt(): ReturnType<Prompt<T[]>["prompt"]> {
    if (this.spec.rise !== false && canAnimate(this.spec.output ?? stdout)) this.startRise();
    return super.prompt();
  }

  private startRise(): void {
    const frames = riseFrames(this.spec.step);
    let next = 1;
    this.held.riseHeight = frames[0];
    this.riseTimer = setInterval(() => {
      this.held.riseHeight = next < frames.length - 1 ? frames[next] : undefined;
      next += 1;
      if (this.held.riseHeight === undefined) this.stopRise();
      // @clack/core 1.5.1 types render() as private but binds it in its constructor, and has no public
      // way to redraw off a keypress. The real-stream tests in picker.test.ts catch it if that changes.
      (this as unknown as { render(): void }).render();
    }, RISE_FRAME_MS);
  }

  private stopRise(): void {
    clearInterval(this.riseTimer);
    this.riseTimer = undefined;
  }

  // Every way a prompt ends goes through close(). Late ticks only redraw the empty final frame, which clack
  // skips, but the timer would still hold the process open until the rise finished.
  protected close(): void {
    this.stopRise();
    super.close();
  }
}

function toKey(key: Key): PickerKey | null {
  if (key.name === "up" || key.name === "down" || key.name === "space") return key.name;
  if (key.name === "return") return "enter";
  return null;
}

function toWizardKey(key: Key): PickerKey | "left" | "right" | null {
  if (key.name === "left" || key.name === "right") return key.name;
  return toKey(key);
}

// Clack's close() always writes a newline after the last frame. The last frame is empty, so step back
// up onto the row it left blank; the next output starts where the question was.
const LINE_UP = "\x1b[1A";

export interface WizardPage<T> {
  message: string;
  options: PickerOption<T>[];
  initial: readonly T[];
  multiple: boolean;
  required?: boolean;
  step: Step;
  body?: string[];
  /** When false, this page does not play the rise even if its step has not been shown. */
  rise?: boolean;
}

export interface WizardRunOptions {
  allowBack?: boolean;
  /** Right on the last page finishes the wizard. Otherwise it stays there. */
  rightOnLast?: "stop" | "done";
  startIndex?: number;
  /** Play the bar rise when a page is shown. Off for a page that opts out with `rise: false`. */
  animate?: boolean;
  input?: Readable;
  output?: Writable;
}

export interface WizardResult<T> {
  exit: "done" | "back";
  answers: T[][];
}

interface WizardHeld<T> extends WizardState<T> {
  riseHeight?: number;
}

class WizardPrompt<T> extends Prompt<T[][]> {
  backed = false;
  private finished = false;
  private readonly pages: WizardPage<T>[];
  private readonly held: WizardHeld<T>;
  private readonly run: { allowBack: boolean; rightOnLast: "stop" | "done"; animate: boolean; output?: Writable };
  private riseTimer: NodeJS.Timeout | undefined;
  private shown = -1;

  constructor(pages: WizardPage<T>[], opts: WizardRunOptions) {
    const held: WizardHeld<T> = { ...initialWizardState(pages, opts.startIndex ?? 0) };
    const output = opts.output;
    super(
      {
        input: opts.input,
        output,
        render() {
          const page = pages[held.index];
          const phase = this.state === "submit" ? "submit" : this.state === "cancel" ? "cancel" : "active";
          const current = held.pages[held.index];
          const notice = this.state === "error" && this.error !== "" ? this.error : current.notice;
          return renderPicker({
            message: page.message,
            options: page.options,
            state: { ...current, notice },
            multiple: page.multiple,
            phase,
            step: page.step,
            body: page.body,
            columns: getColumns(output ?? stdout),
            riseHeight: held.riseHeight,
          });
        },
      },
      false,
    );
    this.pages = pages;
    this.held = held;
    this.run = {
      allowBack: opts.allowBack === true,
      rightOnLast: opts.rightOnLast ?? "stop",
      animate: opts.animate !== false,
      output,
    };
    this.on("key", (_char, key) => {
      const mapped = toWizardKey(key);
      if (mapped === null) return;
      const next = stepWizard(
        this.held,
        mapped,
        pages.map((page) => ({ options: page.options, multiple: page.multiple, required: page.required === true })),
        { allowBack: this.run.allowBack, rightOnLast: this.run.rightOnLast },
      );
      this.held.index = next.state.index;
      this.held.pages = next.state.pages;
      this.syncRise();
      if (!next.back && !next.done) return;
      this.value = this.held.pages.map((page) => [...page.selected]);
      this.backed = next.back;
      this.finished = next.done;
      // Return submits through _shouldSubmit. Any other key has to close the prompt itself.
      if (mapped !== "enter") this.state = "submit";
    });
  }

  protected _shouldSubmit(): boolean {
    return this.finished;
  }

  prompt(): ReturnType<Prompt<T[][]>["prompt"]> {
    this.syncRise();
    return super.prompt();
  }

  private syncRise(): void {
    if (this.shown === this.held.index) return;
    this.shown = this.held.index;
    const page = this.pages[this.held.index];
    const output = this.run.output ?? stdout;
    const play = this.run.animate && page.rise !== false && canAnimate(output);
    this.stopRise();
    if (!play) {
      this.held.riseHeight = undefined;
      return;
    }
    this.startRise(page.step);
  }

  private startRise(step: Step): void {
    const frames = riseFrames(step);
    let next = 1;
    this.held.riseHeight = frames[0];
    this.riseTimer = setInterval(() => {
      this.held.riseHeight = next < frames.length - 1 ? frames[next] : undefined;
      next += 1;
      if (this.held.riseHeight === undefined) this.stopRise();
      // @clack/core 1.5.1 types render() as private but binds it in its constructor, and has no public
      // way to redraw off a keypress. The real-stream tests in picker.test.ts catch it if that changes.
      (this as unknown as { render(): void }).render();
    }, RISE_FRAME_MS);
  }

  private stopRise(): void {
    clearInterval(this.riseTimer);
    this.riseTimer = undefined;
  }

  protected close(): void {
    this.stopRise();
    super.close();
  }
}

/** Ctrl-C resolves to null. Left from the first page resolves to `{ exit: "back" }` when `allowBack` is set. */
export async function wizard<T>(pages: WizardPage<T>[], opts: WizardRunOptions = {}): Promise<WizardResult<T> | null> {
  const prompt = new WizardPrompt(pages, opts);
  const result = await prompt.prompt();
  (opts.output ?? stdout).write(LINE_UP);
  if (isCancel(result) || result === undefined) return null;
  return { exit: prompt.backed ? "back" : "done", answers: result };
}

/** Ctrl-C resolves to null. */
export async function pick<T>(spec: PickOptions<T>): Promise<T[] | null> {
  const required = spec.required === true;
  const held = { state: initialPickerState(spec.options, spec.initial, spec.multiple) };
  const result = await new ListPrompt(spec, held, required).prompt();
  (spec.output ?? stdout).write(LINE_UP);
  if (isCancel(result) || result === undefined) return null;
  return result;
}
