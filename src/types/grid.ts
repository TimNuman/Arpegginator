export interface GridCell {
  row: number;
  col: number;
  active: boolean;
  color: string;
}

// NotePattern: a note with repeat settings
export interface NotePattern {
  length: number; // Note length in steps
  repeatAmount: number; // How many times to repeat (1 = single note, 2+ = repeated)
  repeatSpace: number; // Steps between each repeat
  enabled: boolean; // Whether the note is active (disabled notes are retained but don't play/render)
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

// Helper to create a NotePattern
export const createNotePattern = (
  length: number = 1,
  repeatAmount: number = 1,
  repeatSpace: number = 1,
): NotePattern => {
  return { length, repeatAmount, repeatSpace, enabled: true };
};

// A rendered note instance (for display purposes)
export interface RenderedNote {
  row: number;
  col: number; // Where this note instance starts
  length: number; // Length of this note
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
          notes.push({
            row,
            col: noteCol,
            length,
            sourceCol: col,
            isRepeat: r > 0,
          });
        }
      }
    }
  }

  return notes;
};

// Create a lookup map for quick access: key is "row-col" for note starts
export const createRenderedNotesMap = (
  notes: RenderedNote[],
): Map<string, RenderedNote> => {
  const map = new Map<string, RenderedNote>();
  for (const note of notes) {
    map.set(`${note.row}-${note.col}`, note);
  }
  return map;
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

export interface TransportState {
  isPlaying: boolean;
  bpm: number;
  currentStep: number;
}
