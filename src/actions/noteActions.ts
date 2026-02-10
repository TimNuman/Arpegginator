import { getSequencerStore } from '../store/sequencerStore';
import { getNoteLength, createNotePattern, type NoteValue, type NotePattern, type VelocityLoopMode, type ModifySubMode } from '../types/grid';

/**
 * Helper to truncate any note that would overlap with a new note at col
 */
const truncateOverlappingNote = (gridRow: NoteValue[], col: number): NoteValue[] => {
  const newRow = [...gridRow];
  for (let c = 0; c < col; c++) {
    const noteValue = newRow[c];
    const noteLength = getNoteLength(noteValue);
    if (noteLength > 0 && c + noteLength > col) {
      const newLength = col - c;
      if (noteValue !== null) {
        newRow[c] = { ...noteValue, length: newLength };
      }
    }
  }
  return newRow;
};

/**
 * Toggle a cell on/off at the given position.
 * If the cell has a note (enabled or disabled), delete it.
 * If the cell is empty, create a new note.
 */
export function toggleCell(row: number, col: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];
  const currentValue = channels[currentChannel][pattern][row][col];

  if (currentValue !== null && getNoteLength(currentValue) > 0) {
    // Turn off - delete note
    store._updateCell(currentChannel, pattern, row, col, null);
  } else {
    // Turn on - need to handle truncation via full row update
    const currentRow = [...channels[currentChannel][pattern][row]];
    const truncatedRow = truncateOverlappingNote(currentRow, col);
    truncatedRow[col] = createNotePattern(1);
    store._updateRow(currentChannel, pattern, row, truncatedRow);
  }
}

/**
 * Toggle the enabled state of a note at the given position.
 * If the cell has a note, toggle its enabled flag (preserving the pattern).
 * If the cell is empty, create a new enabled note.
 */
export function toggleEnabled(row: number, col: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];
  const currentValue = channels[currentChannel][pattern][row][col];

  if (currentValue !== null && getNoteLength(currentValue) > 0) {
    // Note exists - toggle enabled
    store._updateCell(currentChannel, pattern, row, col, {
      ...currentValue,
      enabled: !currentValue.enabled,
    });
  } else {
    // Empty - create a new enabled note
    const currentRow = [...channels[currentChannel][pattern][row]];
    const truncatedRow = truncateOverlappingNote(currentRow, col);
    truncatedRow[col] = createNotePattern(1);
    store._updateRow(currentChannel, pattern, row, truncatedRow);
  }
}

/**
 * Set a note with a specific length
 */
export function setNote(row: number, col: number, length: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const currentRow = [...channels[currentChannel][pattern][row]];
  const truncatedRow = truncateOverlappingNote(currentRow, col);

  const existingNote = truncatedRow[col];
  if (existingNote !== null) {
    truncatedRow[col] = { ...existingNote, length };
  } else {
    truncatedRow[col] = createNotePattern(length);
  }

  store._updateRow(currentChannel, pattern, row, truncatedRow);
}

// Stash for notes displaced by a move — restored when the moving note leaves
// Key: "channel:pattern:row:col" → original NoteValue
const displacedNotes = new Map<string, NoteValue>();

function stashKey(ch: number, pat: number, row: number, col: number): string {
  return `${ch}:${pat}:${row}:${col}`;
}

/**
 * Clear the displaced-note stash (called when a move is finalized via placeNote)
 */
export function clearDisplacedNotes(): void {
  displacedNotes.clear();
}

/**
 * Move a note from one position to another.
 * Any existing note at the destination is stashed and restored when the moving note leaves.
 */
export function moveNote(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const grid = channels[currentChannel][pattern];
  const noteValue = grid[fromRow][fromCol];
  const noteLength = getNoteLength(noteValue);

  if (noteLength > 0) {
    // Check what's at the destination (before we overwrite it)
    const destKey = stashKey(currentChannel, pattern, toRow, toCol);
    const destValue = grid[toRow][toCol];
    if (destValue !== null && getNoteLength(destValue) > 0) {
      // There's an existing note at the destination — stash it
      displacedNotes.set(destKey, destValue);
    }

    // Check if we should restore a displaced note at the source
    const srcKey = stashKey(currentChannel, pattern, fromRow, fromCol);
    const restored = displacedNotes.get(srcKey) ?? null;
    if (restored !== null) displacedNotes.delete(srcKey);

    // Create new grid with note moved
    const newGrid = grid.map((row, rowIdx) => {
      if (rowIdx === fromRow && rowIdx === toRow) {
        // Same row - restore source, set destination
        const newRow = [...row];
        newRow[fromCol] = restored;
        newRow[toCol] = noteValue;
        return newRow;
      } else if (rowIdx === fromRow) {
        const newRow = [...row];
        newRow[fromCol] = restored;
        return newRow;
      } else if (rowIdx === toRow) {
        const newRow = [...row];
        newRow[toCol] = noteValue;
        return newRow;
      }
      return row;
    });
    store._updatePattern(currentChannel, pattern, newGrid);
  }
}

/**
 * Place a note (finalize position, truncate overlapping notes, clear stash)
 */
export function placeNote(row: number, col: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const grid = channels[currentChannel][pattern];
  const noteValue = grid[row][col];
  const noteLength = getNoteLength(noteValue);

  if (noteLength > 0) {
    const currentRow = [...grid[row]];
    const truncatedRow = truncateOverlappingNote(currentRow, col);
    truncatedRow[col] = noteValue;
    store._updateRow(currentChannel, pattern, row, truncatedRow);
  }
  displacedNotes.clear();
}

/**
 * Update repeat amount for a note
 */
export function setNoteRepeatAmount(row: number, col: number, repeatAmount: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue !== null) {
    const clampedLength = repeatAmount > 1
      ? Math.min(noteValue.length, noteValue.repeatSpace)
      : noteValue.length;
    store._updateCell(currentChannel, pattern, row, col, {
      ...noteValue,
      repeatAmount,
      length: clampedLength,
    });
  }
}

/**
 * Update repeat space for a note
 */
export function setNoteRepeatSpace(row: number, col: number, repeatSpace: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue !== null) {
    const clampedLength = noteValue.repeatAmount > 1
      ? Math.min(noteValue.length, repeatSpace)
      : noteValue.length;
    store._updateCell(currentChannel, pattern, row, col, {
      ...noteValue,
      repeatSpace,
      length: clampedLength,
    });
  }
}

/**
 * Materialize a looping array to a target length, respecting the loop mode.
 * "reset"/"continue": loop (modulo). "fill": clamp to last value.
 */
function materializeArray(arr: number[], targetLength: number, loopMode: VelocityLoopMode): number[] {
  const result: number[] = [];
  for (let i = 0; i < targetLength; i++) {
    if (loopMode === "fill") {
      result.push(arr[Math.min(i, arr.length - 1)]);
    } else {
      result.push(arr[i % arr.length]);
    }
  }
  return result;
}

/** Maps ModifySubMode to NotePattern field names for array and loop mode */
const SUB_MODE_FIELD_MAP: Record<ModifySubMode, {
  arrayField: keyof NotePattern & string;
  loopModeField: keyof NotePattern & string;
}> = {
  velocity: { arrayField: "velocity", loopModeField: "velocityLoopMode" },
  hit:      { arrayField: "chance",   loopModeField: "chanceLoopMode" },
  timing:   { arrayField: "timingOffset", loopModeField: "timingLoopMode" },
  flam:     { arrayField: "flamChance",   loopModeField: "flamLoopMode" },
  modulate: { arrayField: "modulate",     loopModeField: "modulateLoopMode" },
};

/**
 * Set the value for any sub-mode at a specific repeat index.
 * Materializes the looping array to at least repeatIndex + 1 entries,
 * but preserves any existing length beyond that.
 */
export function setSubModeValue(row: number, col: number, repeatIndex: number, value: number, subMode: ModifySubMode): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const { arrayField, loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const arr = noteValue[arrayField] as number[];
  const loopMode = (noteValue[loopModeField] as VelocityLoopMode) ?? "reset";

  const targetLength = Math.max(arr.length, repeatIndex + 1);
  const materialized = materializeArray(arr, targetLength, loopMode);
  materialized[repeatIndex] = value;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    [arrayField]: materialized,
  });
}

/**
 * Set array length for any sub-mode.
 */
export function setSubModeLength(row: number, col: number, subMode: ModifySubMode, newLength: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const { arrayField, loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const arr = noteValue[arrayField] as number[];
  const loopMode = (noteValue[loopModeField] as VelocityLoopMode) ?? "reset";
  const clamped = Math.max(1, newLength);
  const result = materializeArray(arr, clamped, loopMode);

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    [arrayField]: result,
  });
}

/**
 * Toggle loop mode (reset → continue → fill → reset) for any sub-mode.
 */
export function toggleSubModeLoopMode(row: number, col: number, subMode: ModifySubMode): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const modes: VelocityLoopMode[] = ["reset", "continue", "fill"];
  const { loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const currentMode = (noteValue[loopModeField] as VelocityLoopMode) ?? "reset";
  const currentIndex = modes.indexOf(currentMode);
  const newMode = modes[(currentIndex + 1) % modes.length];

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    [loopModeField]: newMode,
  });
}
