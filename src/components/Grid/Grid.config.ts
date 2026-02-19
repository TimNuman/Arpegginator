import {
  SUBDIVISION_TICKS,
  type ModifySubMode,
  type Subdivision,
} from "../../types/event";

// ============ Keyboard to grid position mapping ============

export const KEY_MAP: Record<string, { row: number; col: number }> = {
  "1": { row: 4, col: 0 },
  "2": { row: 4, col: 1 },
  "3": { row: 4, col: 2 },
  "4": { row: 4, col: 3 },
  "5": { row: 4, col: 4 },
  "6": { row: 4, col: 5 },
  "7": { row: 4, col: 6 },
  "8": { row: 4, col: 7 },
  q: { row: 5, col: 0 },
  w: { row: 5, col: 1 },
  e: { row: 5, col: 2 },
  r: { row: 5, col: 3 },
  t: { row: 5, col: 4 },
  y: { row: 5, col: 5 },
  u: { row: 5, col: 6 },
  i: { row: 5, col: 7 },
  a: { row: 6, col: 0 },
  s: { row: 6, col: 1 },
  d: { row: 6, col: 2 },
  f: { row: 6, col: 3 },
  g: { row: 6, col: 4 },
  h: { row: 6, col: 5 },
  j: { row: 6, col: 6 },
  k: { row: 6, col: 7 },
  z: { row: 7, col: 0 },
  x: { row: 7, col: 1 },
  c: { row: 7, col: 2 },
  v: { row: 7, col: 3 },
  b: { row: 7, col: 4 },
  n: { row: 7, col: 5 },
  m: { row: 7, col: 6 },
  ",": { row: 7, col: 7 },
};

// ============ WASM constants (must match engine_input.h) ============

// Modifier flags
export const MOD_CTRL = 1;
export const MOD_SHIFT = 2;
export const MOD_META = 4;
export const MOD_ALT = 8;

// Direction constants
export const DIR_UP = 0;
export const DIR_DOWN = 1;
export const DIR_LEFT = 2;
export const DIR_RIGHT = 3;

// Action IDs
export const ACTION_DESELECT = 1;
export const ACTION_ZOOM_IN = 2;
export const ACTION_ZOOM_OUT = 3;
export const ACTION_DELETE_NOTE = 4;
export const ACTION_CLEAR_PATTERN = 5;

// ============ UI mode / sub-mode mappings ============

// UI mode names (index = C enum value)
export const UI_MODE_NAMES = ["pattern", "channel", "loop", "modify"] as const;
export type UiMode = (typeof UI_MODE_NAMES)[number];

// Sub-mode names (index = C enum value)
export const SUB_MODE_NAMES: ModifySubMode[] = [
  "velocity",
  "hit",
  "timing",
  "flam",
  "modulate",
];

// Subdivision names indexed by ticks-per-col (reverse lookup)
export const TICKS_TO_SUBDIVISION: Record<number, Subdivision> = {};
for (const [name, tpc] of Object.entries(SUBDIVISION_TICKS)) {
  TICKS_TO_SUBDIVISION[tpc] = name as Subdivision;
}

// Sub-mode config for OLED display
export const SUB_MODE_CONFIG: Record<ModifySubMode, { label: string }> = {
  velocity: { label: "VEL" },
  hit: { label: "HIT" },
  timing: { label: "TIME" },
  flam: { label: "FLAM" },
  modulate: { label: "MOD" },
};

// Loop mode names (index = C enum value)
export const LOOP_MODE_NAMES = ["reset", "continue", "fill"] as const;
