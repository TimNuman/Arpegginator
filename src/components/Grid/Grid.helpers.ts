import { TICKS_PER_QUARTER } from "../../types/event";
import { MOD_CTRL, MOD_SHIFT, MOD_META, MOD_ALT } from "./Grid.config";

export const noop = () => {};

/** Convert MIDI note number to note name (e.g. 60 → "C4") */
export const midiNoteToName = (midiNote: number): string => {
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
};

/** Convert tick value to subdivision-relative display string */
export const ticksToDisplay = (
  ticks: number,
  ticksPerCol: number,
): string => {
  const cols = ticks / ticksPerCol;
  if (cols === Math.floor(cols)) return `${cols}`;
  return cols.toFixed(1);
};

/** Convert tick position to beat.subdivision display (e.g. 480 → "2", 600 → "2.2") */
export const tickToBeatDisplay = (tick: number): string => {
  const beat = Math.floor(tick / TICKS_PER_QUARTER) + 1;
  const subTick = tick % TICKS_PER_QUARTER;
  if (subTick === 0) return `${beat}`;
  const sixteenth = Math.floor(subTick / (TICKS_PER_QUARTER / 4)) + 1;
  return `${beat}.${sixteenth}`;
};

/** Musical subdivision names for tick values (TICKS_PER_QUARTER = 480) */
const MUSICAL_NAMES: [number, string][] = [
  [30,  "1/64"],
  [40,  "1/32T"],
  [45,  "1/64."],
  [60,  "1/32"],
  [80,  "1/16T"],
  [90,  "1/32."],
  [120, "1/16"],
  [160, "1/8T"],
  [180, "1/16."],
  [240, "1/8"],
  [320, "1/4T"],
  [360, "1/8."],
  [480, "1/4"],
  [640, "1/2T"],
  [720, "1/4."],
  [960, "1/2"],
  [1440, "1/2."],
  [1920, "1"],
];

/** Triplet musical names only */
const TRIPLET_NAMES = new Map<number, string>([
  [40,  "1/32T"],
  [80,  "1/16T"],
  [160, "1/8T"],
  [320, "1/4T"],
  [640, "1/2T"],
]);

/** Convert tick duration to musical subdivision name relative to zoom level.
 *  Multiples of zoom show as N/[zoom denom] (e.g. 480 at 1/16 zoom → "4/16").
 *  Triplets keep musical names (e.g. 160 → "1/8T"). */
export const ticksToMusicalName = (ticks: number, zoomTicks: number): string => {
  // Triplets always use musical name
  const triplet = TRIPLET_NAMES.get(ticks);
  if (triplet) return triplet;

  // Multiples of zoom level: show as N/[zoom denom]
  if (ticks > 0 && ticks % zoomTicks === 0) {
    const n = ticks / zoomTicks;
    const whole = 1920;
    const den = whole / zoomTicks;
    return `${n}/${den}`;
  }

  // Sub-zoom values: use MUSICAL_NAMES lookup
  for (const [t, name] of MUSICAL_NAMES) {
    if (t === ticks) return name;
  }
  return `${ticks}t`;
};

/** Convert tick duration to canonical musical name (always simplified).
 *  Prefers "1/4" over "2/8", uses MUSICAL_NAMES lookup first. */
export const ticksToCanonicalName = (ticks: number): string => {
  const triplet = TRIPLET_NAMES.get(ticks);
  if (triplet) return triplet;

  for (const [t, name] of MUSICAL_NAMES) {
    if (t === ticks) return name;
  }

  // Multiples of whole notes
  const whole = 1920;
  if (ticks > 0 && ticks % whole === 0) {
    return `${ticks / whole}`;
  }

  // Try expressing as N/denom using the simplest denominator
  for (const [t, name] of MUSICAL_NAMES) {
    if (t > 0 && ticks % t === 0) {
      const n = ticks / t;
      // Extract denominator from name like "1/4" → 4
      const m = name.match(/^1\/(\d+)$/);
      if (m) return `${n}/${m[1]}`;
    }
  }

  return `${ticks}t`;
};

/** Convert uint32 packed 0xRRGGBB to "#RRGGBB" hex string */
export function uint32ToHex(val: number): string {
  const r = (val >> 16) & 0xff;
  const g = (val >> 8) & 0xff;
  const b = val & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Encode modifier keys into bit flags matching engine_input.h */
export function encodeModifiers(state: {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}): number {
  let flags = 0;
  if (state.ctrl) flags |= MOD_CTRL;
  if (state.shift) flags |= MOD_SHIFT;
  if (state.meta) flags |= MOD_META;
  if (state.alt) flags |= MOD_ALT;
  return flags;
}
