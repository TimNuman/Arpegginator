import { describe, it, expect, beforeEach } from 'vitest';
import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { createNoteEvent, createEmptyPatternData, WHOLE_NOTE } from '../types/event';
import { buildScaleMapping, noteToMidi, SCALES } from '../types/scales';
import { cycleScaleRoot, cycleScale } from './scaleActions';

// ============ Helpers ============

/** Build the current scale mapping from store state */
function currentMapping() {
  const store = getSequencerStore();
  const pattern = SCALES[store.scaleId]?.pattern ?? SCALES.major.pattern;
  return buildScaleMapping(store.scaleRoot, pattern);
}

/** Get the MIDI notes for all events via the current scale mapping */
function getEventMidis(channel: number = 0, pattern: number = 0): number[] {
  const mapping = currentMapping();
  return getSequencerStore().patterns[channel][pattern].events.map(
    e => noteToMidi(e.row, mapping),
  );
}

/** Get the rows for all events */
function getEventRows(channel: number = 0, pattern: number = 0): number[] {
  return getSequencerStore().patterns[channel][pattern].events.map(e => e.row);
}

/** Place notes at given rows, computing originalMidi from the current scale */
function placeNotes(rows: number[], channel: number = 0, pattern: number = 0): void {
  const store = getSequencerStore();
  const mapping = currentMapping();
  for (const row of rows) {
    const midi = noteToMidi(row, mapping);
    const event = createNoteEvent(row, 0, 120, 1, 120, "1/16", midi);
    store._addEvent(channel, pattern, event);
  }
}

/** Reset the store to a clean C major state with empty patterns */
function resetStore(): void {
  const store = getSequencerStore();
  store._setScale(0, "major");
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    for (let pat = 0; pat < store.patterns[ch].length; pat++) {
      store._setPatternData(ch, pat, createEmptyPatternData("1/16", WHOLE_NOTE * 4));
    }
  }
}

/** Assert rows are consecutive integers */
function assertConsecutive(rows: number[]): void {
  const sorted = [...rows].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i] - sorted[i - 1]).toBe(1);
  }
}

// ============ Tests ============

describe('cycleScaleRoot — single step & round-trips', () => {
  beforeEach(resetStore);

  it('C→G: CDEFGAB becomes CDEF#GAB', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);
    cycleScaleRoot("up"); // C → G

    expect(getSequencerStore().scaleRoot).toBe(7);
    expect(getEventMidis()).toEqual([60, 62, 64, 66, 67, 69, 71]);
  });

  it('C→G→C round-trip: all notes return to original rows', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);
    const rowsBefore = getEventRows();
    const midisBefore = getEventMidis();

    cycleScaleRoot("up");   // C → G
    cycleScaleRoot("down"); // G → C

    expect(getSequencerStore().scaleRoot).toBe(0);
    expect(getEventRows()).toEqual(rowsBefore);
    expect(getEventMidis()).toEqual(midisBefore);
  });

  it('full circle of fifths (12 ups): rows shift by +1 (Pythagorean drift)', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);

    for (let i = 0; i < 12; i++) cycleScaleRoot("up");

    expect(getSequencerStore().scaleRoot).toBe(0);
    // Each note drifts up by 1 scale degree after a full cycle
    expect(getEventRows()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('full circle of fifths (12 downs): rows shift by -1 (Pythagorean drift)', () => {
    placeNotes([-3, 0, 4, 7]);

    for (let i = 0; i < 12; i++) cycleScaleRoot("down");

    expect(getSequencerStore().scaleRoot).toBe(0);
    // Each note drifts down by 1 scale degree after a full cycle
    expect(getEventRows()).toEqual([-4, -1, 3, 6]);
  });

  it('3 ups then 3 downs returns to original state', () => {
    placeNotes([-7, -2, 0, 3, 5, 10]);
    const rowsBefore = getEventRows();
    const midisBefore = getEventMidis();

    for (let i = 0; i < 3; i++) cycleScaleRoot("up");
    for (let i = 0; i < 3; i++) cycleScaleRoot("down");

    expect(getSequencerStore().scaleRoot).toBe(0);
    expect(getEventRows()).toEqual(rowsBefore);
    expect(getEventMidis()).toEqual(midisBefore);
  });

  it('5 ups then 5 downs returns to original state', () => {
    placeNotes([0, 3, 6]);
    const rowsBefore = getEventRows();
    const midisBefore = getEventMidis();

    for (let i = 0; i < 5; i++) cycleScaleRoot("up");
    for (let i = 0; i < 5; i++) cycleScaleRoot("down");

    expect(getSequencerStore().scaleRoot).toBe(0);
    expect(getEventRows()).toEqual(rowsBefore);
    expect(getEventMidis()).toEqual(midisBefore);
  });

  it('drum channels are not affected', () => {
    const store = getSequencerStore();
    const drumEvent = createNoteEvent(36, 0, 120, 1, 120, "1/16", -1);
    store._addEvent(6, 0, drumEvent);

    cycleScaleRoot("up");

    const drumRow = getSequencerStore().patterns[6][0].events[0].row;
    expect(drumRow).toBe(36);
  });

  it('events across multiple channels and patterns are all remapped', () => {
    placeNotes([0], 0, 0);
    placeNotes([4], 1, 0);
    placeNotes([2], 2, 1);

    const midi0 = getEventMidis(0, 0);
    const midi1 = getEventMidis(1, 0);
    const midi2 = getEventMidis(2, 1);

    cycleScaleRoot("up");

    expect(getEventMidis(0, 0)).toEqual(midi0);
    expect(getEventMidis(1, 0)).toEqual(midi1);
    expect(getEventMidis(2, 1)).toEqual(midi2);
  });

  it('events with originalMidi=-1 (legacy) are skipped', () => {
    const store = getSequencerStore();
    const event = createNoteEvent(3, 0, 120);
    store._addEvent(0, 0, event);

    cycleScaleRoot("up");

    expect(getSequencerStore().patterns[0][0].events[0].row).toBe(3);
  });
});

describe('cycleScaleRoot — consecutive rows at every CoF step', () => {
  beforeEach(resetStore);

  it('CDEFGABC (8 notes): all 12 CoF-up steps produce consecutive rows', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6, 7]);
    const cofRoots = [7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 0];

    for (let step = 0; step < 12; step++) {
      cycleScaleRoot("up");
      expect(getSequencerStore().scaleRoot).toBe(cofRoots[step]);
      const rows = getEventRows();
      expect(new Set(rows).size).toBe(8);
      assertConsecutive(rows);
    }

    // Full cycle drifts by +1 row (Pythagorean comma in scale-degree space)
    expect(getEventRows()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('CDEFGABC (8 notes): all 12 CoF-down steps produce consecutive rows', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6, 7]);
    const cofRootsDown = [5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7, 0];

    for (let step = 0; step < 12; step++) {
      cycleScaleRoot("down");
      expect(getSequencerStore().scaleRoot).toBe(cofRootsDown[step]);
      const rows = getEventRows();
      expect(new Set(rows).size).toBe(8);
      assertConsecutive(rows);
    }

    // Full cycle drifts by -1 row
    expect(getEventRows()).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);
  });

  it('CDEFGAB (7 notes): all 12 CoF-up steps produce consecutive rows', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);
    const cofRoots = [7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 0];

    for (let step = 0; step < 12; step++) {
      cycleScaleRoot("up");
      expect(getSequencerStore().scaleRoot).toBe(cofRoots[step]);
      const rows = getEventRows();
      expect(new Set(rows).size).toBe(7);
      assertConsecutive(rows);
    }

    expect(getEventRows()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('chromatic: MIDI pitches preserved at every step (no snapping needed)', () => {
    const store = getSequencerStore();
    store._setScale(0, "chromatic");
    placeNotes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const midisBefore = getEventMidis();
    const rowsBefore = getEventRows();

    for (let i = 0; i < 12; i++) {
      cycleScaleRoot("up");
      expect(getEventMidis()).toEqual(midisBefore);
    }

    expect(getEventRows()).toEqual(rowsBefore);
  });

  it('natural minor: all 12 CoF-up steps produce consecutive rows', () => {
    const store = getSequencerStore();
    store._setScale(0, "naturalMinor");
    placeNotes([0, 1, 2, 3, 4, 5, 6]);

    for (let i = 0; i < 12; i++) {
      cycleScaleRoot("up");
      const rows = getEventRows();
      expect(new Set(rows).size).toBe(7);
      assertConsecutive(rows);
    }

    expect(getSequencerStore().scaleRoot).toBe(0);
  });

  it('pentatonic: all 12 CoF-up steps produce consecutive rows', () => {
    const store = getSequencerStore();
    store._setScale(0, "majorPentatonic");
    placeNotes([0, 1, 2, 3, 4]);

    for (let i = 0; i < 12; i++) {
      cycleScaleRoot("up");
      const rows = getEventRows();
      expect(new Set(rows).size).toBe(5);
      assertConsecutive(rows);
    }

    expect(getSequencerStore().scaleRoot).toBe(0);
  });

  it('C→G: F snaps to F# (up toward new accidental)', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6, 7]);
    cycleScaleRoot("up");
    assertConsecutive(getEventRows());
    expect(getEventMidis()).toEqual([60, 62, 64, 66, 67, 69, 71, 72]);
  });

  it('C→F: B snaps to Bb (down toward new accidental)', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6, 7]);
    cycleScaleRoot("down");
    assertConsecutive(getEventRows());
    expect(getEventMidis()).toEqual([60, 62, 64, 65, 67, 69, 70, 72]);
  });
});

describe('cycleScale — scale type changes', () => {
  beforeEach(resetStore);

  it('does not remap events (rows stay the same)', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);
    const rowsBefore = getEventRows();

    cycleScale("up");

    expect(getSequencerStore().scaleId).toBe("naturalMinor");
    expect(getEventRows()).toEqual(rowsBefore);
  });

  it('cycling through all scales and back preserves rows', () => {
    placeNotes([0, 2, 4]);
    const rowsBefore = getEventRows();
    const totalScales = Object.keys(SCALES).length;

    for (let i = 0; i < totalScales; i++) cycleScale("up");

    expect(getSequencerStore().scaleId).toBe("major");
    expect(getEventRows()).toEqual(rowsBefore);
  });

  it('up then down returns to original scale', () => {
    cycleScale("up");
    cycleScale("down");
    expect(getSequencerStore().scaleId).toBe("major");
  });
});

describe('combined root + scale cycling', () => {
  beforeEach(resetStore);

  it('root change + scale change + undo both: fully lossless', () => {
    placeNotes([0, 1, 2, 3, 4, 5, 6]);
    const rowsBefore = getEventRows();
    const midisBefore = getEventMidis();

    cycleScaleRoot("up");
    cycleScale("up");
    cycleScale("down");
    cycleScaleRoot("down");

    expect(getSequencerStore().scaleRoot).toBe(0);
    expect(getSequencerStore().scaleId).toBe("major");
    expect(getEventRows()).toEqual(rowsBefore);
    expect(getEventMidis()).toEqual(midisBefore);
  });
});
