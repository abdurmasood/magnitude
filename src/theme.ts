import { styleText } from "node:util";

// Styles are nested calls, not arrays: array formats need a newer Node than package.json's engine.
// Brand colors are exact RGB where the terminal allows it: named ANSI colors are remapped by terminal themes.

type StyleName = Parameters<typeof styleText>[0] & string;

interface Color {
  rgb: [number, number, number];
  ansi256: number;
  named: StyleName;
}

const FOREGROUND = {
  magenta: { rgb: [214, 144, 227], ansi256: 177, named: "magentaBright" },
  green: { rgb: [143, 210, 139], ansi256: 114, named: "greenBright" },
  yellow: { rgb: [230, 199, 108], ansi256: 179, named: "yellow" },
  gray: { rgb: [85, 91, 97], ansi256: 240, named: "gray" },
  key: { rgb: [232, 232, 232], ansi256: 253, named: "white" },
  brand: { rgb: [22, 22, 22], ansi256: 233, named: "black" },
} satisfies Record<string, Color>;

const BACKGROUND = {
  key: { rgb: [52, 56, 61], ansi256: 237, named: "bgGray" },
  brand: { rgb: [214, 144, 227], ansi256: 177, named: "bgMagentaBright" },
} satisfies Record<string, Color>;

/** 1 = no color, 4 = 16 colors, 8 = 256 colors, 24 = true color. */
export type ColorDepth = 1 | 4 | 8 | 24;

let depthOverride: ColorDepth | undefined;

/** For tests. `undefined` goes back to asking stdout, which honors NO_COLOR, FORCE_COLOR and COLORTERM. */
export function setColorDepth(depth: ColorDepth | undefined): void {
  depthOverride = depth;
}

function colorDepth(): number {
  return depthOverride ?? process.stdout.getColorDepth?.() ?? 1;
}

function paint(color: Color, layer: 38 | 48, text: string): string {
  const depth = colorDepth();
  const reset = layer === 38 ? 39 : 49;
  if (depth >= 24) return `\x1b[${layer};2;${color.rgb.join(";")}m${text}\x1b[${reset}m`;
  if (depth >= 8) return `\x1b[${layer};5;${color.ansi256}m${text}\x1b[${reset}m`;
  // The depth check above already decided color is on; don't let styleText decide again.
  if (depth >= 4) return styleText(color.named, text, { validateStream: false });
  return text;
}

export function foreground(color: keyof typeof FOREGROUND, text: string): string {
  return paint(FOREGROUND[color], 38, text);
}

export function background(color: keyof typeof BACKGROUND, text: string): string {
  return paint(BACKGROUND[color], 48, text);
}

export const STEPS = ["agents", "location", "skills", "review"] as const;

/** An index into STEPS. STEPS.length means every step is done. */
export type Step = number;

export const DOCS_URL = "github.com/abdurmasood/magnitude";

export function headerLine(): string {
  return `${foreground("magenta", "▁▃▅▇")}${styleText("bold", " magnitude")}${styleText("dim", "   skills for Claude Code, Cursor and Codex")}`;
}

function stepMark(name: string, index: number, current: Step): string {
  if (index < current) return foreground("green", `✓ ${name}`);
  if (index === current) return foreground("magenta", styleText("bold", `● ${name}`));
  return styleText("dim", `○ ${name}`);
}

export function stepperLine(current: Step): string {
  return STEPS.map((name, index) => stepMark(name, index, current)).join(foreground("gray", " ── "));
}

export function keyLabel(key: string): string {
  return background("key", foreground("key", ` ${key} `));
}

export function footerLine(): string {
  const move = `${keyLabel("↑↓")}${styleText("dim", " move")}`;
  const select = `${keyLabel("enter")}${styleText("dim", " select")}`;
  return `${move}   ${select}${styleText("dim", "   Submit continues")}`;
}

/** Same text either way, so the row does not shift when the cursor lands on it. */
export function submitLabel(focused: boolean): string {
  if (!focused) return keyLabel("Submit");
  return background("brand", foreground("brand", styleText("bold", " Submit ")));
}

export function cursorBar(active: boolean): string {
  return active ? foreground("magenta", "▌ ") : "  ";
}
