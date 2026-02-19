
// ============ Tick-Based Event Model ============

// Velocity loop mode: "reset" resets with pattern loop, "continue" keeps counting across loops, "fill" clamps to last value
export type VelocityLoopMode = "reset" | "continue" | "fill";

// Modify sub-modes: velocity and different aspects of randomization per repeat
export type ModifySubMode = "velocity" | "hit" | "timing" | "flam" | "modulate";

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
export const TRIPLET_QUARTER    = (TICKS_PER_QUARTER * 2) / 3; // 320
export const TRIPLET_EIGHTH     = TICKS_PER_QUARTER / 3;     // 160
export const TRIPLET_SIXTEENTH  = TICKS_PER_QUARTER / 6;     // 80
export const DOTTED_QUARTER     = (TICKS_PER_QUARTER * 3) / 2; // 720
export const DOTTED_EIGHTH      = (TICKS_PER_QUARTER * 3) / 4; // 360

// ============ Pattern Speed ============

export type PatternSpeed = "1/4" | "1/4T" | "1/8" | "1/8T" | "1/16" | "1/16T" | "1/32";

export const PATTERN_SPEED_TICKS: Record<PatternSpeed, number> = {
  "1/4":  QUARTER_NOTE,       // 480
  "1/4T": TRIPLET_QUARTER,    // 320
  "1/8":  EIGHTH_NOTE,        // 240
  "1/8T": TRIPLET_EIGHTH,     // 160
  "1/16": SIXTEENTH_NOTE,     // 120
  "1/16T": TRIPLET_SIXTEENTH, // 80
  "1/32": THIRTY_SECOND_NOTE, // 60
};

/** Ordered from slowest to fastest (for cycling: up = faster = toward 1/32) */
export const PATTERN_SPEED_ORDER: PatternSpeed[] = [
  "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32",
];

// ============ Subdivision ============

export type Subdivision = "1/4" | "1/8" | "1/16" | "1/32" | "1/64";

export const SUBDIVISION_TICKS: Record<Subdivision, number> = {
  "1/4": QUARTER_NOTE,
  "1/8": EIGHTH_NOTE,
  "1/16": SIXTEENTH_NOTE,
  "1/32": THIRTY_SECOND_NOTE,
  "1/64": SIXTY_FOURTH_NOTE,
};

/** All subdivisions ordered from coarsest to finest (for zoom cycling) */
export const SUBDIVISION_ORDER: Subdivision[] = [
  "1/4", "1/8", "1/16", "1/32", "1/64",
];

// ============ NoteEvent ============

export interface NoteEvent {
  id: string;
  row: number;                   // Scale-relative index (0 = root at octave 4)
  position: number;              // Start position in ticks (0-based within pattern)
  length: number;                // Duration in ticks
  enabled: boolean;

  // Speed (determines repeat grid step)
  speed: PatternSpeed;           // Note speed (default matches zoom)

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

  // Chord stack (pitch stacking on Y axis)
  chordStackSize: number;       // 1 = single note, 2-5 = chord
  chordShapeIndex: number;      // which shape for this stack size
  chordInversion: number;       // inversion: 0 = root, +N = bottom note up, -N = top note down

  // Absolute pitch anchor — MIDI note when placed/last edited.
  // Used by scale root changes to remap losslessly from the original pitch.
  originalMidi: number;
}

// ============ PatternData ============

export interface PatternData {
  events: NoteEvent[];
  subdivision: Subdivision;      // Per-pattern default snap grid
  lengthTicks: number;           // Total pattern length in ticks
}

// ============ TickLookupMap ============

/** Maps tick position → list of NoteEvents starting at that tick (including expanded repeats) */
export type TickLookupMap = Map<number, { event: NoteEvent; repeatIndex: number }[]>;

// ============ Factory Functions ============

/** Create a new NoteEvent with default sub-mode values */
export const createNoteEvent = (
  row: number,
  position: number,
  length: number = SIXTEENTH_NOTE,
  repeatAmount: number = 1,
  repeatSpace: number = SIXTEENTH_NOTE,
  speed: PatternSpeed = "1/16",
  originalMidi: number = -1,
): NoteEvent => ({
  id: crypto.randomUUID(),
  row,
  position,
  length,
  enabled: true,
  speed,
  repeatAmount,
  repeatSpace,
  velocity: [100],
  velocityLoopMode: "reset",
  chance: [100],
  chanceLoopMode: "reset",
  timingOffset: [0],
  timingLoopMode: "reset",
  flamChance: [0],
  flamLoopMode: "reset",
  modulate: [0],
  modulateLoopMode: "reset",
  chordStackSize: 1,
  chordShapeIndex: 0,
  chordInversion: 0,
  originalMidi,
});

/** Create an empty PatternData */
export const createEmptyPatternData = (
  subdivision: Subdivision = "1/16",
  lengthTicks: number = WHOLE_NOTE * 4, // 4 bars
): PatternData => ({
  events: [],
  subdivision,
  lengthTicks,
});

// ============ Sub-Mode Helpers ============

/** Default values per sub-mode (returned when no NoteEvent exists) */
export const SUB_MODE_DEFAULTS: Record<ModifySubMode, number> = {
  velocity: 100, hit: 100, timing: 0, flam: 0, modulate: 0,
};

/** Maps ModifySubMode to NoteEvent field names */
export const SUB_MODE_FIELD_MAP: Record<ModifySubMode, {
  arrayField: keyof NoteEvent & string;
  loopModeField: keyof NoteEvent & string;
}> = {
  velocity: { arrayField: "velocity", loopModeField: "velocityLoopMode" },
  hit:      { arrayField: "chance",   loopModeField: "chanceLoopMode" },
  timing:   { arrayField: "timingOffset", loopModeField: "timingLoopMode" },
  flam:     { arrayField: "flamChance",   loopModeField: "flamLoopMode" },
  modulate: { arrayField: "modulate",     loopModeField: "modulateLoopMode" },
};

export const getEventSubModeLoopMode = (event: NoteEvent, subMode: ModifySubMode): VelocityLoopMode => {
  const { loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  return (event[loopModeField] as VelocityLoopMode) ?? "reset";
};

export const getEventSubModeArray = (event: NoteEvent, subMode: ModifySubMode): number[] => {
  const { arrayField } = SUB_MODE_FIELD_MAP[subMode];
  return event[arrayField] as number[];
};

/** Get value at a specific repeat index (loops the array) */
export const getEventSubModeValueAtRepeat = (event: NoteEvent, subMode: ModifySubMode, repeatIndex: number): number => {
  const arr = getEventSubModeArray(event, subMode);
  return arr[repeatIndex % arr.length];
};

/** Get value at a specific repeat index, clamped to last entry (for "fill" mode) */
export const getEventSubModeValueAtRepeatFill = (event: NoteEvent, subMode: ModifySubMode, repeatIndex: number): number => {
  const arr = getEventSubModeArray(event, subMode);
  return arr[Math.min(repeatIndex, arr.length - 1)];
};

// ============ Tick Lookup Map Builder ============

/**
 * Build a lookup map from events, expanding repeats.
 * Returns a Map<tick, {event, repeatIndex}[]> for O(1) playback access.
 */
export const buildTickLookup = (
  events: NoteEvent[],
  patternLengthTicks: number,
): TickLookupMap => {
  const map: TickLookupMap = new Map();

  for (const event of events) {
    if (!event.enabled) continue;

    for (let r = 0; r < event.repeatAmount; r++) {
      const tick = event.position + r * event.repeatSpace;
      if (tick >= patternLengthTicks) break;

      const existing = map.get(tick);
      const entry = { event, repeatIndex: r };
      if (existing) {
        existing.push(entry);
      } else {
        map.set(tick, [entry]);
      }
    }
  }

  return map;
};


