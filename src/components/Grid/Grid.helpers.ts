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
