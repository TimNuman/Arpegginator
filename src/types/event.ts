
// ============ Tick-Based Event Model ============

// Velocity loop mode: "reset" resets with pattern loop, "continue" keeps counting across loops, "fill" clamps to last value
export type VelocityLoopMode = "reset" | "continue" | "fill";

// Modify sub-modes: velocity and different aspects of randomization per repeat
export type ModifySubMode = "velocity" | "hit" | "timing" | "flam" | "modulate" | "inversion";

// ============ Time Constants ============

export const TICKS_PER_QUARTER = 480;

// Note duration constants (derived from TICKS_PER_QUARTER)
export const WHOLE_NOTE         = TICKS_PER_QUARTER * 4;     // 1920
export const HALF_NOTE          = TICKS_PER_QUARTER * 2;     // 960
export const QUARTER_NOTE       = TICKS_PER_QUARTER;         // 480
export const EIGHTH_NOTE        = TICKS_PER_QUARTER / 2;     // 240
export const SIXTEENTH_NOTE     = TICKS_PER_QUARTER / 4;     // 120
export const THIRTY_SECOND_NOTE = TICKS_PER_QUARTER / 8;     // 60
export const SIXTY_FOURTH_NOTE  = TICKS_PER_QUARTER / 16;    // 30

// ============ Subdivision ============

export type Subdivision = "1/4" | "1/8" | "1/16" | "1/32" | "1/64";

export const SUBDIVISION_TICKS: Record<Subdivision, number> = {
  "1/4": QUARTER_NOTE,
  "1/8": EIGHTH_NOTE,
  "1/16": SIXTEENTH_NOTE,
  "1/32": THIRTY_SECOND_NOTE,
  "1/64": SIXTY_FOURTH_NOTE,
};

// ============ NoteEvent ============

export interface NoteEvent {
  id: string;
  row: number;                   // Scale-relative index (0 = root at octave 4)
  position: number;              // Start position in ticks (0-based within pattern)
  length: number;                // Duration in ticks
  enabled: boolean;

  // Repeat system (in ticks)
  repeatAmount: number;          // 1 = no repeats
  repeatSpace: number;           // Ticks between repeats

  // Sub-mode arrays (per-repeat values with independent loop modes)
  velocity: number[];
  velocityLoopMode: VelocityLoopMode;
  chance: number[];
  chanceLoopMode: VelocityLoopMode;
  timingOffset: number[];
  timingLoopMode: VelocityLoopMode;
  flamChance: number[];
  flamLoopMode: VelocityLoopMode;
  modulate: number[];
  modulateLoopMode: VelocityLoopMode;
  inversion: number[];
  inversionLoopMode: VelocityLoopMode;

  // Chord (pitch stacking on Y axis)
  chordAmount: number;          // 1 = single note, 2-5 = chord
  chordSpace: number;           // scale-degree gap between chord notes (default 2 = thirds)
  chordInversion: number;       // inversion: infinite, +N = bottom notes up, -N = top notes down
  chordVoicing: number;         // voicing index (0 = base, cycles through predefined shapes)

  // Arpeggio (chord notes cycle on repeats)
  arpStyle: number;             // 0=CHORD, 1=UP, 2=DOWN, 3=UP_DOWN, 4=DOWN_UP
  arpOffset: number;            // starting offset into arp cycle
  arpVoices: number;            // simultaneous chord notes per arp step (1 = single, max = chordAmount-1)
}

// ============ PatternData ============

export interface PatternData {
  events: NoteEvent[];
  lengthTicks: number;           // Total pattern length in ticks
}
