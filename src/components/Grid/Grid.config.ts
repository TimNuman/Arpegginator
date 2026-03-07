// ============ Time Constants (must match WASM TICKS_PER_QUARTER) ============

export const TICKS_PER_QUARTER = 480;

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

// ============ WASM constants (must match engine_input) ============

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

// UI mode indices (must match UiMode enum in engine_core.rs)
export const UI_MODE_LOOP = 2;
