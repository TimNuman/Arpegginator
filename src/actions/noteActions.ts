import { getSequencerStore } from '../store/sequencerStore';
import { invalidateLookup } from '../store/tickLookupCache';
import {
  createNoteEvent,
  findEventById,
  type NoteEvent,
  type VelocityLoopMode,
  type ModifySubMode,
  SUB_MODE_FIELD_MAP,
  SIXTEENTH_NOTE,
  PATTERN_SPEED_TICKS,
  PATTERN_SPEED_ORDER,
} from '../types/event';
import { getShapeCount, getMaxInversion } from '../types/chords';
import { SCALES, buildScaleMapping, noteToMidi } from '../types/scales';

/** Resolve a scale-relative row to its MIDI note using the current scale. */
function rowToMidi(row: number): number {
  const store = getSequencerStore();
  const pattern = SCALES[store.scaleId]?.pattern ?? SCALES.major.pattern;
  const mapping = buildScaleMapping(store.scaleRoot, pattern);
  return noteToMidi(row, mapping);
}

// ============ Helpers ============

/** Get current channel/pattern/events from store */
function getCurrentPatternContext() {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, patterns } = store;
  const patternIdx = currentPatterns[currentChannel];
  const patternData = patterns[currentChannel][patternIdx];
  return { store, currentChannel, patternIdx, patternData };
}

/**
 * Truncate any events on the same row that overlap with a new event at the given position.
 */
function truncateOverlapping(events: NoteEvent[], row: number, position: number, excludeId?: string): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns } = store;
  const patternIdx = currentPatterns[currentChannel];

  for (const event of events) {
    if (event.row !== row) continue;
    if (event.id === excludeId) continue;
    if (event.position < position && event.position + event.length > position) {
      // This event overlaps — truncate it
      store._updateEvent(currentChannel, patternIdx, event.id, {
        length: position - event.position,
      });
    }
  }
}

// ============ Note Actions ============

/**
 * Toggle an event on/off at the given (row, tick) position.
 * If an event exists at this position, delete it.
 * If no event exists, create a new one.
 */
export function toggleEvent(row: number, tick: number, lengthTicks: number = SIXTEENTH_NOTE): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();

  // Find existing event at this exact position
  const existing = patternData.events.find(
    (e) => e.row === row && e.position === tick && e.enabled,
  );

  if (existing) {
    // Remove the event
    store._removeEvent(currentChannel, patternIdx, existing.id);
  } else {
    // Check for disabled event at this position
    const disabled = patternData.events.find(
      (e) => e.row === row && e.position === tick && !e.enabled,
    );
    if (disabled) {
      store._removeEvent(currentChannel, patternIdx, disabled.id);
    }

    // Create new event, truncating any overlapping notes
    truncateOverlapping(patternData.events, row, tick);
    const event = createNoteEvent(row, tick, lengthTicks, 1, SIXTEENTH_NOTE, "1/16", rowToMidi(row));
    store._addEvent(currentChannel, patternIdx, event);
  }
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Toggle the enabled state of an event.
 * If no event exists at (row, tick), create a new enabled one.
 */
export function toggleEventEnabled(eventId: string): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);

  if (event) {
    store._updateEvent(currentChannel, patternIdx, eventId, {
      enabled: !event.enabled,
    });
  }
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Toggle event enabled by position (for pattern mode click on disabled notes)
 */
export function toggleEnabledAtPosition(row: number, tick: number, lengthTicks: number = SIXTEENTH_NOTE): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const existing = patternData.events.find(
    (e) => e.row === row && e.position === tick,
  );

  if (existing) {
    store._updateEvent(currentChannel, patternIdx, existing.id, {
      enabled: !existing.enabled,
    });
  } else {
    // Create new enabled event
    truncateOverlapping(patternData.events, row, tick);
    const event = createNoteEvent(row, tick, lengthTicks, 1, SIXTEENTH_NOTE, "1/16", rowToMidi(row));
    store._addEvent(currentChannel, patternIdx, event);
  }
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Move an event to a new position and/or row.
 */
export function moveEvent(eventId: string, newRow: number, newPosition: number): void {
  const { store, currentChannel, patternIdx } = getCurrentPatternContext();
  store._updateEvent(currentChannel, patternIdx, eventId, {
    row: newRow,
    position: newPosition,
    originalMidi: rowToMidi(newRow),
  });
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Set the length of an event.
 */
export function setEventLength(eventId: string, lengthTicks: number): void {
  const { store, currentChannel, patternIdx } = getCurrentPatternContext();
  store._updateEvent(currentChannel, patternIdx, eventId, {
    length: lengthTicks,
  });
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Finalize event position (truncate overlapping notes).
 */
export function placeEvent(eventId: string): void {
  const { currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (event) {
    truncateOverlapping(patternData.events, event.row, event.position, event.id);
  }
  displacedEvents.clear();
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Update repeat amount for an event
 */
export function setEventRepeatAmount(eventId: string, repeatAmount: number): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const clampedLength = repeatAmount > 1
    ? Math.min(event.length, event.repeatSpace)
    : event.length;

  store._updateEvent(currentChannel, patternIdx, eventId, {
    repeatAmount,
    length: clampedLength,
  });
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Update repeat space for an event
 */
export function setEventRepeatSpace(eventId: string, repeatSpace: number): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const clampedLength = event.repeatAmount > 1
    ? Math.min(event.length, repeatSpace)
    : event.length;

  store._updateEvent(currentChannel, patternIdx, eventId, {
    repeatSpace,
    length: clampedLength,
  });
  invalidateLookup(currentChannel, patternIdx);
}

// ============ Speed Cycling ============

/**
 * Cycle the speed of a NoteEvent. Adjusts repeatSpace and length proportionally.
 * Position stays the same. Length is clamped so notes don't overlap repeats.
 * "faster" = toward 1/32 (smaller ticks), "slower" = toward 1/4 (larger ticks).
 */
export function cycleNoteSpeed(eventId: string, direction: "faster" | "slower"): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const currentSpeed = event.speed ?? "1/16";
  const currentIndex = PATTERN_SPEED_ORDER.indexOf(currentSpeed);
  if (currentIndex === -1) return;

  const nextIndex = direction === "faster"
    ? Math.min(PATTERN_SPEED_ORDER.length - 1, currentIndex + 1)
    : Math.max(0, currentIndex - 1);

  if (nextIndex === currentIndex) return;

  const newSpeed = PATTERN_SPEED_ORDER[nextIndex];
  const oldTicks = PATTERN_SPEED_TICKS[currentSpeed];
  const newTicks = PATTERN_SPEED_TICKS[newSpeed];

  // Scale repeatSpace proportionally
  const newRepeatSpace = Math.round(event.repeatSpace * newTicks / oldTicks);

  // Keep length the same, only clamp if it would overlap the next repeat
  let newLength = event.length;
  if (event.repeatAmount > 1 && newLength > newRepeatSpace) {
    newLength = newRepeatSpace;
  }

  store._updateEvent(currentChannel, patternIdx, eventId, {
    speed: newSpeed,
    repeatSpace: newRepeatSpace,
    length: newLength,
  });
  invalidateLookup(currentChannel, patternIdx);
}

// ============ Displaced Events Stash ============

// Stash for events displaced by a move — restored when the moving event leaves
const displacedEvents = new Map<string, NoteEvent>();

export function clearDisplacedEvents(): void {
  displacedEvents.clear();
}

// ============ Sub-Mode Operations ============

/**
 * Materialize a looping array to a target length, respecting the loop mode.
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
 * Set the value for any sub-mode at a specific repeat index.
 */
export function setSubModeValue(eventId: string, repeatIndex: number, value: number, subMode: ModifySubMode): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const { arrayField, loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const arr = event[arrayField] as number[];
  const loopMode = (event[loopModeField] as VelocityLoopMode) ?? "reset";

  const targetLength = Math.max(arr.length, repeatIndex + 1);
  const materialized = materializeArray(arr, targetLength, loopMode);
  materialized[repeatIndex] = value;

  store._updateEvent(currentChannel, patternIdx, eventId, {
    [arrayField]: materialized,
  } as Partial<NoteEvent>);
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Set array length for any sub-mode.
 */
export function setSubModeLength(eventId: string, subMode: ModifySubMode, newLength: number): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const { arrayField, loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const arr = event[arrayField] as number[];
  const loopMode = (event[loopModeField] as VelocityLoopMode) ?? "reset";
  const clamped = Math.max(1, newLength);
  const result = materializeArray(arr, clamped, loopMode);

  store._updateEvent(currentChannel, patternIdx, eventId, {
    [arrayField]: result,
  } as Partial<NoteEvent>);
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Toggle loop mode (reset → continue → fill → reset) for any sub-mode.
 */
export function toggleSubModeLoopMode(eventId: string, subMode: ModifySubMode): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const modes: VelocityLoopMode[] = ["reset", "continue", "fill"];
  const { loopModeField } = SUB_MODE_FIELD_MAP[subMode];
  const currentMode = (event[loopModeField] as VelocityLoopMode) ?? "reset";
  const currentIndex = modes.indexOf(currentMode);
  const newMode = modes[(currentIndex + 1) % modes.length];

  store._updateEvent(currentChannel, patternIdx, eventId, {
    [loopModeField]: newMode,
  } as Partial<NoteEvent>);
  invalidateLookup(currentChannel, patternIdx);
}

// ============ Chord Stack Operations ============

/**
 * Adjust the chord stack size (Cmd+Up to add, Cmd+Down to remove).
 * When shrinking, clamp shape index and reset inversion if they exceed new bounds.
 */
export function adjustChordStack(eventId: string, direction: "up" | "down"): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  const newSize = direction === "up"
    ? Math.min(5, event.chordStackSize + 1)
    : Math.max(1, event.chordStackSize - 1);

  if (newSize === event.chordStackSize) return;

  // Clamp shape index if it exceeds available shapes for the new size
  const shapeCount = getShapeCount(newSize);
  const newShapeIndex = event.chordShapeIndex >= shapeCount ? 0 : event.chordShapeIndex;

  // Clamp inversion to valid range for new size
  const maxInv = getMaxInversion(newSize);
  const newInversion = Math.max(-maxInv, Math.min(maxInv, event.chordInversion));

  store._updateEvent(currentChannel, patternIdx, eventId, {
    chordStackSize: newSize,
    chordShapeIndex: newShapeIndex,
    chordInversion: newInversion,
  });
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Cycle through chord shapes (Cmd+Shift+Up/Down).
 */
export function cycleChordShape(eventId: string, direction: "up" | "down"): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  if (event.chordStackSize <= 1) return; // No shapes for single notes

  const shapeCount = getShapeCount(event.chordStackSize);
  const delta = direction === "up" ? 1 : -1;
  const newIndex = ((event.chordShapeIndex + delta) % shapeCount + shapeCount) % shapeCount;

  store._updateEvent(currentChannel, patternIdx, eventId, {
    chordShapeIndex: newIndex,
  });
  invalidateLookup(currentChannel, patternIdx);
}

/**
 * Cycle chord inversion (Shift+Up/Down in pattern mode with selected note).
 * Up = bottom note +octave, Down = top note -octave.
 */
export function cycleChordInversion(eventId: string, direction: "up" | "down"): void {
  const { store, currentChannel, patternIdx, patternData } = getCurrentPatternContext();
  const event = findEventById(patternData.events, eventId);
  if (!event) return;

  if (event.chordStackSize <= 1) return; // No inversions for single notes

  const maxInv = getMaxInversion(event.chordStackSize);
  const delta = direction === "up" ? 1 : -1;
  const newInversion = Math.max(-maxInv, Math.min(maxInv, event.chordInversion + delta));

  if (newInversion === event.chordInversion) return;

  store._updateEvent(currentChannel, patternIdx, eventId, {
    chordInversion: newInversion,
  });
  invalidateLookup(currentChannel, patternIdx);
}
