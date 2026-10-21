import { stdout } from "node:process";
import type { Key } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import { getColumns, isCancel, Prompt } from "@clack/core";
import { cursorBar, footerLine, foreground, type Step, stepperLine, submitLabel } from "./theme.js";

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
  return { cursor: 0, selected: seed(options, initial, multiple), notice: "" };
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
  const lines = [stepperLine(input.step), "", styleText("bold", input.message), ...(input.body ?? []), ""];
  lines.push(...optionLines(input), "", `${cursorBar(onSubmit)}${submitLabel(onSubmit)}`);
  if (input.state.notice !== "") lines.push(foreground("yellow", `  ${input.state.notice}`));
  lines.push("", footerLine());
  return lines.join("\n");
}

interface Held<T> {
  state: PickerState<T>;
}

interface PickOptions<T> {
  message: string;
  options: PickerOption<T>[];
  initial: readonly T[];
  multiple: boolean;
  step: Step;
  body?: string[];
  required?: boolean;
  input?: Readable;
  output?: Writable;
}

class ListPrompt<T> extends Prompt<T[]> {
  private cursor: number;
  private readonly submitAt: number;

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
          });
        },
      },
      false,
    );
    this.submitAt = spec.options.length;
    this.cursor = held.state.cursor;
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
}

function toKey(key: Key): PickerKey | null {
  if (key.name === "up" || key.name === "down" || key.name === "space") return key.name;
  if (key.name === "return") return "enter";
  return null;
}

// Clack's close() always writes a newline after the last frame. The last frame is empty, so step back
// up onto the row it left blank; the next output starts where the question was.
const LINE_UP = "\x1b[1A";

/** Ctrl-C resolves to null. */
export async function pick<T>(spec: PickOptions<T>): Promise<T[] | null> {
  const required = spec.required === true;
  const held = { state: initialPickerState(spec.options, spec.initial, spec.multiple) };
  const result = await new ListPrompt(spec, held, required).prompt();
  (spec.output ?? stdout).write(LINE_UP);
  if (isCancel(result) || result === undefined) return null;
  return result;
}
