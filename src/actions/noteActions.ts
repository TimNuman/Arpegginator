import { getSequencerStore } from '../store/sequencerStore';
import { getNoteLength, createNotePattern, type NoteValue, type VelocityLoopMode, type ChanceSubMode } from '../types/grid';

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

/**
 * Set velocity for a specific repeat index of a note.
 * Materializes the looping velocity array to at least repeatIndex + 1 entries,
 * but preserves any existing length beyond that.
 */
export function setNoteVelocity(row: number, col: number, repeatIndex: number, velocity: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  // Materialize to at least repeatIndex + 1, but keep existing length if longer
  const targetLength = Math.max(noteValue.velocity.length, repeatIndex + 1);
  const materialized = materializeArray(noteValue.velocity, targetLength, noteValue.velocityLoopMode);
  materialized[repeatIndex] = velocity;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    velocity: materialized,
  });
}

/**
 * Set the velocity array length for a note.
 * Expanding: materializes values for new entries (respecting loop mode).
 * Shrinking: truncates from the end (minimum length 1).
 */
export function setVelocityLength(row: number, col: number, newLength: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const clamped = Math.max(1, newLength);
  const result = materializeArray(noteValue.velocity, clamped, noteValue.velocityLoopMode);

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    velocity: result,
  });
}

/**
 * Cycle velocity loop mode: reset → continue → fill → reset.
 */
export function toggleVelocityLoopMode(row: number, col: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const modes: VelocityLoopMode[] = ["reset", "continue", "fill"];
  const currentIndex = modes.indexOf(noteValue.velocityLoopMode);
  const newMode = modes[(currentIndex + 1) % modes.length];
  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    velocityLoopMode: newMode,
  });
}

/**
 * Set chance for a specific repeat index of a note.
 * Materializes the looping array to at least repeatIndex + 1 entries,
 * but preserves any existing length beyond that.
 */
export function setNoteChance(row: number, col: number, repeatIndex: number, chance: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const targetLength = Math.max(noteValue.chance.length, repeatIndex + 1);
  const materialized = materializeArray(noteValue.chance, targetLength, noteValue.chanceLoopMode ?? "reset");
  materialized[repeatIndex] = chance;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    chance: materialized,
  });
}

/**
 * Set micro-timing offset (as % of step, signed) for a specific repeat index of a note.
 * Materializes the looping array to at least repeatIndex + 1 entries.
 */
export function setNoteTimingOffset(row: number, col: number, repeatIndex: number, value: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const targetLength = Math.max(noteValue.timingOffset.length, repeatIndex + 1);
  const materialized = materializeArray(noteValue.timingOffset, targetLength, noteValue.timingLoopMode ?? "reset");
  materialized[repeatIndex] = value;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    timingOffset: materialized,
  });
}

/**
 * Set flam chance for a specific repeat index of a note.
 * Materializes the looping array to at least repeatIndex + 1 entries.
 */
export function setNoteFlamChance(row: number, col: number, repeatIndex: number, value: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const targetLength = Math.max(noteValue.flamChance.length, repeatIndex + 1);
  const materialized = materializeArray(noteValue.flamChance, targetLength, noteValue.flamLoopMode ?? "reset");
  materialized[repeatIndex] = value;

  store._updateCell(currentChannel, pattern, row, col, {
    ...noteValue,
    flamChance: materialized,
  });
}

/**
 * Set array length for any sub-mode.
 * Dispatches to the correct array (velocity/chance/timingOffset/flamChance).
 */
export function setSubModeLength(row: number, col: number, subMode: ChanceSubMode, newLength: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const clamped = Math.max(1, newLength);

  switch (subMode) {
    case "velocity": {
      const result = materializeArray(noteValue.velocity, clamped, noteValue.velocityLoopMode);
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, velocity: result });
      break;
    }
    case "hit": {
      const result = materializeArray(noteValue.chance, clamped, noteValue.chanceLoopMode ?? "reset");
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, chance: result });
      break;
    }
    case "timing": {
      const result = materializeArray(noteValue.timingOffset, clamped, noteValue.timingLoopMode ?? "reset");
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, timingOffset: result });
      break;
    }
    case "flam": {
      const result = materializeArray(noteValue.flamChance, clamped, noteValue.flamLoopMode ?? "reset");
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, flamChance: result });
      break;
    }
  }
}

/**
 * Toggle loop mode (reset → continue → fill → reset) for any sub-mode.
 */
export function toggleSubModeLoopMode(row: number, col: number, subMode: ChanceSubMode): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels } = store;
  const pattern = currentPatterns[currentChannel];

  const noteValue = channels[currentChannel][pattern][row][col];
  if (noteValue === null) return;

  const modes: VelocityLoopMode[] = ["reset", "continue", "fill"];

  switch (subMode) {
    case "velocity": {
      const currentIndex = modes.indexOf(noteValue.velocityLoopMode);
      const newMode = modes[(currentIndex + 1) % modes.length];
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, velocityLoopMode: newMode });
      break;
    }
    case "hit": {
      const currentIndex = modes.indexOf(noteValue.chanceLoopMode ?? "reset");
      const newMode = modes[(currentIndex + 1) % modes.length];
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, chanceLoopMode: newMode });
      break;
    }
    case "timing": {
      const currentIndex = modes.indexOf(noteValue.timingLoopMode ?? "reset");
      const newMode = modes[(currentIndex + 1) % modes.length];
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, timingLoopMode: newMode });
      break;
    }
    case "flam": {
      const currentIndex = modes.indexOf(noteValue.flamLoopMode ?? "reset");
      const newMode = modes[(currentIndex + 1) % modes.length];
      store._updateCell(currentChannel, pattern, row, col, { ...noteValue, flamLoopMode: newMode });
      break;
    }
  }
}
