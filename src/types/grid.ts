// Velocity loop mode: "reset" resets with pattern loop, "continue" keeps counting across loops, "fill" clamps to last value
export type VelocityLoopMode = "reset" | "continue" | "fill";

// Modify sub-modes: velocity and different aspects of randomization per repeat
export type ModifySubMode = "velocity" | "hit" | "timing" | "flam" | "modulate";

// NotePattern: a note with repeat settings
export interface NotePattern {
  length: number; // Note length in steps
  repeatAmount: number; // How many times to repeat (1 = single note, 2+ = repeated)
  repeatSpace: number; // Steps between each repeat
  enabled: boolean; // Whether the note is active (disabled notes are retained but don't play/render)
  velocity: number[]; // Looping velocity array over repeats, default [100]
  velocityLoopMode: VelocityLoopMode; // How velocity loops interact with pattern loops
  chance: number[]; // Per-repeat chance array (0-100%), default [100]
  chanceLoopMode: VelocityLoopMode; // How chance loops interact with pattern loops
  timingOffset: number[]; // Per-repeat micro-timing offset as % of step (signed, e.g. -20 to +20), default [0]
  timingLoopMode: VelocityLoopMode; // How timing offset loops interact with pattern loops
  flamChance: number[]; // Per-repeat flam probability (0-100%), default [0]
  flamLoopMode: VelocityLoopMode; // How flam chance loops interact with pattern loops
  modulate: number[]; // Per-repeat pitch offset in half steps (signed), default [0]
  modulateLoopMode: VelocityLoopMode; // How modulate loops interact with pattern loops
}

// Note value: null = no note, NotePattern = note with settings
export type NoteValue = null | NotePattern;

// Helper to check if a value is a NotePattern
export const isNotePattern = (value: NoteValue): value is NotePattern => {
  return value !== null && typeof value === "object" && "length" in value;
};

// Helper to get note length from NoteValue
export const getNoteLength = (value: NoteValue): number => {
  if (!isNotePattern(value)) return 0;
  return value.length;
};

// Helper to get repeat amount from NoteValue
export const getRepeatAmount = (value: NoteValue): number => {
  if (!isNotePattern(value)) return 0;
  return value.repeatAmount;
};

// Helper to get repeat space from NoteValue
export const getRepeatSpace = (value: NoteValue): number => {
  if (!isNotePattern(value)) return 4;
  return value.repeatSpace;
};

// Helper to check if a note is enabled
export const isNoteEnabled = (value: NoteValue): boolean => {
  if (!isNotePattern(value)) return false;
  return value.enabled;
};

// Default values per sub-mode (returned when no NotePattern exists)
export const SUB_MODE_DEFAULTS: Record<ModifySubMode, number> = {
  velocity: 100, hit: 100, timing: 0, flam: 0, modulate: 0,
};

// Consolidated sub-mode helpers
export const getSubModeLoopMode = (value: NoteValue, subMode: ModifySubMode): VelocityLoopMode => {
  if (!isNotePattern(value)) return "reset";
  switch (subMode) {
    case "velocity": return value.velocityLoopMode;
    case "hit": return value.chanceLoopMode ?? "reset";
    case "timing": return value.timingLoopMode ?? "reset";
    case "flam": return value.flamLoopMode ?? "reset";
    case "modulate": return value.modulateLoopMode ?? "reset";
  }
};

export const getSubModeArray = (value: NoteValue, subMode: ModifySubMode): number[] => {
  if (!isNotePattern(value)) {
    return [SUB_MODE_DEFAULTS[subMode]];
  }
  switch (subMode) {
    case "velocity": return value.velocity;
    case "hit": return value.chance;
    case "timing": return value.timingOffset;
    case "flam": return value.flamChance;
    case "modulate": return value.modulate;
  }
};

export const getSubModeArrayLength = (value: NoteValue, subMode: ModifySubMode): number => {
  return getSubModeArray(value, subMode).length;
};

// Get value at a specific repeat index (loops the array)
export const getSubModeValueAtRepeat = (value: NoteValue, subMode: ModifySubMode, repeatIndex: number): number => {
  if (!isNotePattern(value)) return SUB_MODE_DEFAULTS[subMode];
  const arr = getSubModeArray(value, subMode);
  return arr[repeatIndex % arr.length];
};

// Get value at a specific repeat index, clamped to last entry (for "fill" mode)
export const getSubModeValueAtRepeatFill = (value: NoteValue, subMode: ModifySubMode, repeatIndex: number): number => {
  if (!isNotePattern(value)) return SUB_MODE_DEFAULTS[subMode];
  const arr = getSubModeArray(value, subMode);
  return arr[Math.min(repeatIndex, arr.length - 1)];
};

// Helper to create a NotePattern
export const createNotePattern = (
  length: number = 1,
  repeatAmount: number = 1,
  repeatSpace: number = 1,
): NotePattern => {
  return { length, repeatAmount, repeatSpace, enabled: true, velocity: [100], velocityLoopMode: "reset", chance: [100], chanceLoopMode: "reset", timingOffset: [0], timingLoopMode: "reset", flamChance: [0], flamLoopMode: "reset", modulate: [0], modulateLoopMode: "reset" };
};

// A rendered note instance (for display purposes)
export interface RenderedNote {
  row: number; // Display row (after modulation offset)
  col: number; // Where this note instance starts
  length: number; // Length of this note
  sourceRow: number; // Row of the parent NotePattern in gridState
  sourceCol: number; // Column of the parent NotePattern
  isRepeat: boolean; // True if this is a repeat (not the original)
}

// Render all enabled NotePatterns in a grid to a flat array of RenderedNotes
// Disabled notes are skipped entirely (they are invisible)
export const renderNotesToArray = (
  grid: GridState,
  gridWidth: number = 64,
): RenderedNote[] => {
  const notes: RenderedNote[] = [];

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const noteValue = grid[row][col];
      if (noteValue === null || !noteValue.enabled) continue;

      const { length, repeatAmount, repeatSpace } = noteValue;

      // Add the original note and all its repeats
      for (let r = 0; r < repeatAmount; r++) {
        const noteCol = col + r * repeatSpace;
        // Only include notes that start within the grid
        if (noteCol < gridWidth) {
          const modOffset = getSubModeValueAtRepeat(noteValue, "modulate", r);
          const displayRow = Math.max(0, Math.min(grid.length - 1, row + modOffset));
          notes.push({
            row: displayRow,
            col: noteCol,
            length,
            sourceRow: row,
            sourceCol: col,
            isRepeat: r > 0,
          });
        }
      }
    }
  }

  return notes;
};

// Check if a cell is covered by any rendered note (start or continuation)
export const findNoteAtCell = (
  notes: RenderedNote[],
  row: number,
  col: number,
): RenderedNote | null => {
  for (const note of notes) {
    if (note.row === row && col >= note.col && col < note.col + note.length) {
      return note;
    }
  }
  return null;
};

export type GridState = NoteValue[][];
