// ============ Channel Types ============

export type ChannelType = "melodic" | "drum";

// ============ Drum Constants ============

export const DRUM_TOTAL_ROWS = 128;
export const DRUM_MIN_ROW = 0;
export const DRUM_MAX_ROW = 127;

// ============ General MIDI Drum Names ============

/** Short names (≤7 chars) for GM drum notes (MIDI 35-81) */
export const GM_DRUM_NAMES: Record<number, string> = {
  35: "Kick 2",
  36: "Kick",
  37: "Stick",
  38: "Snare",
  39: "Clap",
  40: "E.Snr",
  41: "Lo Tom",
  42: "Cl HH",
  43: "Hi Tom",
  44: "Ped HH",
  45: "Lo Tom",
  46: "Op HH",
  47: "LM Tom",
  48: "HM Tom",
  49: "Crash",
  50: "Hi Tom",
  51: "Ride",
  52: "China",
  53: "RideBl",
  54: "Tamb",
  55: "Splash",
  56: "Cowbel",
  57: "Crash2",
  58: "Vibra",
  59: "Ride2",
  60: "Hi Bon",
  61: "Lo Bon",
  62: "Mt Con",
  63: "Op Con",
  64: "Lo Con",
  65: "Hi Tim",
  66: "Lo Tim",
  67: "Hi Aga",
  68: "Lo Aga",
  69: "Cabasa",
  70: "Maraca",
  71: "S.Whst",
  72: "L.Whst",
  73: "S.Guir",
  74: "L.Guir",
  75: "Claves",
  76: "Hi Blk",
  77: "Lo Blk",
  78: "Mt Cga",
  79: "Op Cga",
  80: "Mt Tri",
  81: "Op Tri",
};

/** Get a short display name for a MIDI drum note */
export function getDrumName(midiNote: number): string {
  return GM_DRUM_NAMES[midiNote] ?? `D${midiNote}`;
}
