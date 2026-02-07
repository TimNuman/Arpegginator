import { getSequencerStore } from '../store/sequencerStore';
import { getNoteLength, createNotePattern, type NoteValue } from '../types/grid';

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

/**
 * Move a note from one position to another (no truncation while moving)
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
    // Create new grid with note moved
    const newGrid = grid.map((row, rowIdx) => {
      if (rowIdx === fromRow && rowIdx === toRow) {
        // Same row - clear from, set to
        const newRow = [...row];
        newRow[fromCol] = null;
        newRow[toCol] = noteValue;
        return newRow;
      } else if (rowIdx === fromRow) {
        const newRow = [...row];
        newRow[fromCol] = null;
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
 * Place a note (finalize position, truncate overlapping notes)
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
 * Set velocity for a specific repeat index of a note.
 * Materializes the looping velocity array up to the given index and sets the value.
 */
export function setNoteVelocity(row: number, col: number, repeatIndex: number, velocity: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  // Materialize the looping array up to repeatIndex + 1 entries
  const materialized: number[] = [];
  for (let i = 0; i <= repeatIndex; i++) {
    materialized.push(noteValue.velocity[i % noteValue.velocity.length]);
  }
  materialized[repeatIndex] = velocity;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    velocity: materialized,
  });
}
