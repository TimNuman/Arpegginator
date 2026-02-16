import { describe, it, expect, beforeAll } from 'vitest';
import {
  getShapesForSize,
  getShapeCount,
  invertShape,
  getChordOffsets,
  getMaxInversion,
} from './chords';

// ============ Shape Generation ============

describe('getShapesForSize', () => {
  it('returns [[0]] for stack size 1', () => {
    expect(getShapesForSize(1)).toEqual([[0]]);
  });

  it('returns correct shapes for stack size 2 (intervals)', () => {
    const shapes = getShapesForSize(2);
    // Size 2: all [0, x] where x is 1..2 (maxSpan = 2*(2-1) = 2)
    expect(shapes).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it('returns correct shapes for stack size 3 (triads)', () => {
    const shapes = getShapesForSize(3);
    // Size 3: maxSpan = 2*(3-1) = 4
    // All ascending combos [0, a, b] with a < b, b <= 4
    // Sorted by span (b value), then lexicographically
    expect(shapes).toEqual([
      [0, 1, 2], // span 2
      [0, 1, 3], // span 3
      [0, 2, 3], // span 3
      [0, 1, 4], // span 4
      [0, 2, 4], // span 4
      [0, 3, 4], // span 4
    ]);
  });

  it('returns correct number of shapes for stack size 4', () => {
    const shapes = getShapesForSize(4);
    // Size 4: maxSpan = 2*(4-1) = 6
    // All ascending combos [0, a, b, c] with a < b < c, c <= 6
    // First shape should be most compact: [0, 1, 2, 3]
    expect(shapes[0]).toEqual([0, 1, 2, 3]);
    // Last shape should be widest: [0, 4, 5, 6]
    expect(shapes[shapes.length - 1]).toEqual([0, 4, 5, 6]);
    // Verify count — C(6,3) = 20
    expect(shapes.length).toBe(20);
  });

  it('returns correct number of shapes for stack size 5', () => {
    const shapes = getShapesForSize(5);
    // Size 5: maxSpan = 2*(5-1) = 8
    // All ascending combos [0, a, b, c, d] with a < b < c < d, d <= 8
    // C(8,4) = 70
    expect(shapes.length).toBe(70);
    expect(shapes[0]).toEqual([0, 1, 2, 3, 4]);
  });

  it('all shapes start with 0', () => {
    for (let size = 1; size <= 5; size++) {
      for (const shape of getShapesForSize(size)) {
        expect(shape[0]).toBe(0);
      }
    }
  });

  it('all shapes are strictly ascending', () => {
    for (let size = 1; size <= 5; size++) {
      for (const shape of getShapesForSize(size)) {
        for (let i = 1; i < shape.length; i++) {
          expect(shape[i]).toBeGreaterThan(shape[i - 1]);
        }
      }
    }
  });

  it('shapes are sorted by span then lexicographically', () => {
    for (let size = 2; size <= 5; size++) {
      const shapes = getShapesForSize(size);
      for (let i = 1; i < shapes.length; i++) {
        const prevSpan = shapes[i - 1][shapes[i - 1].length - 1];
        const currSpan = shapes[i][shapes[i].length - 1];
        if (prevSpan === currSpan) {
          // Same span — should be lexicographically ordered
          let isLexSmaller = false;
          for (let j = 0; j < shapes[i].length; j++) {
            if (shapes[i - 1][j] < shapes[i][j]) { isLexSmaller = true; break; }
            if (shapes[i - 1][j] > shapes[i][j]) break;
          }
          expect(isLexSmaller).toBe(true);
        } else {
          expect(prevSpan).toBeLessThan(currSpan);
        }
      }
    }
  });

  it('clamps to 1 for stack size < 1', () => {
    expect(getShapesForSize(0)).toEqual([[0]]);
    expect(getShapesForSize(-5)).toEqual([[0]]);
  });

  it('clamps to 5 for stack size > 5', () => {
    expect(getShapesForSize(6)).toEqual(getShapesForSize(5));
    expect(getShapesForSize(100)).toEqual(getShapesForSize(5));
  });
});

// ============ Shape Count ============

describe('getShapeCount', () => {
  it('returns 1 for single notes', () => {
    expect(getShapeCount(1)).toBe(1);
  });

  it('returns correct counts for each stack size', () => {
    expect(getShapeCount(2)).toBe(2);   // [0,1], [0,2]
    expect(getShapeCount(3)).toBe(6);   // C(4,2) = 6
    expect(getShapeCount(4)).toBe(20);  // C(6,3) = 20
    expect(getShapeCount(5)).toBe(70);  // C(8,4) = 70
  });
});

// ============ Inversions ============

describe('invertShape', () => {
  describe('root position (inversion = 0)', () => {
    it('returns the original shape unchanged', () => {
      expect(invertShape([0, 2, 4], 0)).toEqual([0, 2, 4]);
      expect(invertShape([0, 1, 2, 3], 0)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('single note', () => {
    it('returns [0] regardless of inversion', () => {
      expect(invertShape([0], 1)).toEqual([0]);
      expect(invertShape([0], -1)).toEqual([0]);
    });
  });

  describe('positive inversions (bottom note up)', () => {
    it('first inversion of triad [0,2,4]', () => {
      // Bottom note 0 goes up by 7: [2, 4, 7] → normalized: [0, 2, 5]
      expect(invertShape([0, 2, 4], 1)).toEqual([0, 2, 5]);
    });

    it('second inversion of triad [0,2,4]', () => {
      // After 1st: [2, 4, 7]
      // Bottom note 2 goes up by 7: [4, 7, 9] → normalized: [0, 3, 5]
      expect(invertShape([0, 2, 4], 2)).toEqual([0, 3, 5]);
    });

    it('first inversion of [0,1,2]', () => {
      // Bottom note 0 goes up by 7: [1, 2, 7] → normalized: [0, 1, 6]
      expect(invertShape([0, 1, 2], 1)).toEqual([0, 1, 6]);
    });

    it('first inversion of interval [0,1]', () => {
      // Bottom note 0 goes up by 7: [1, 7] → normalized: [0, 6]
      expect(invertShape([0, 1], 1)).toEqual([0, 6]);
    });

    it('first inversion of interval [0,2]', () => {
      // Bottom note 0 goes up by 7: [2, 7] → normalized: [0, 5]
      expect(invertShape([0, 2], 1)).toEqual([0, 5]);
    });
  });

  describe('negative inversions (top note down)', () => {
    it('first negative inversion of triad [0,2,4]', () => {
      // Top note 4 goes down by 7: [-3, 0, 2] → normalized: [0, 3, 5]
      expect(invertShape([0, 2, 4], -1)).toEqual([0, 3, 5]);
    });

    it('second negative inversion of triad [0,2,4]', () => {
      // After -1: [-3, 0, 2]
      // Top note 2 goes down by 7: [-5, -3, 0] → normalized: [0, 2, 5]
      expect(invertShape([0, 2, 4], -2)).toEqual([0, 2, 5]);
    });

    it('first negative inversion of interval [0,1]', () => {
      // Top note 1 goes down by 7: [-6, 0] → normalized: [0, 6]
      expect(invertShape([0, 1], -1)).toEqual([0, 6]);
    });
  });

  describe('normalization', () => {
    it('always starts from 0', () => {
      for (const shape of [[0, 1, 2], [0, 2, 4], [0, 1, 3, 5]]) {
        for (let inv = -(shape.length - 1); inv <= shape.length - 1; inv++) {
          const result = invertShape(shape, inv);
          expect(result[0]).toBe(0);
        }
      }
    });

    it('result is always ascending', () => {
      for (const shape of [[0, 1, 2], [0, 2, 4], [0, 1, 3, 5]]) {
        for (let inv = -(shape.length - 1); inv <= shape.length - 1; inv++) {
          const result = invertShape(shape, inv);
          for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeGreaterThan(result[i - 1]);
          }
        }
      }
    });

    it('result has same number of notes as input', () => {
      for (const shape of [[0, 1], [0, 1, 2], [0, 2, 4], [0, 1, 2, 3, 4]]) {
        for (let inv = -(shape.length - 1); inv <= shape.length - 1; inv++) {
          const result = invertShape(shape, inv);
          expect(result.length).toBe(shape.length);
        }
      }
    });
  });

  describe('full cycle returns to original', () => {
    it('inverting N times equals wrapping around the octave', () => {
      const shape = [0, 2, 4]; // 3 notes
      // Inversion 3 should cycle: 0→7, 2→9, 4→11, then normalized
      // Actually let's just verify +3 and -3 produce a full cycle
      const inv3 = invertShape(shape, 3);
      // After 3 positive inversions: each note shifted up by 7 once
      // [0,2,4] → [2,4,7] → [4,7,9] → [7,9,11] → normalized [0,2,4]
      expect(inv3).toEqual([0, 2, 4]);
    });

    it('negative full cycle returns to original', () => {
      const shape = [0, 2, 4];
      const invNeg3 = invertShape(shape, -3);
      expect(invNeg3).toEqual([0, 2, 4]);
    });
  });
});

// ============ getMaxInversion ============

describe('getMaxInversion', () => {
  it('returns 0 for single notes', () => {
    expect(getMaxInversion(1)).toBe(0);
  });

  it('returns stackSize - 1 for stacks', () => {
    expect(getMaxInversion(2)).toBe(1);
    expect(getMaxInversion(3)).toBe(2);
    expect(getMaxInversion(4)).toBe(3);
    expect(getMaxInversion(5)).toBe(4);
  });

  it('returns 0 for 0 or negative', () => {
    expect(getMaxInversion(0)).toBe(0);
    expect(getMaxInversion(-1)).toBe(0);
  });
});

// ============ getChordOffsets ============

describe('getChordOffsets', () => {
  it('returns [0] for single note', () => {
    expect(getChordOffsets(1, 0, 0)).toEqual([0]);
  });

  it('returns first shape root position for stack of 2', () => {
    // First shape for size 2 is [0, 1]
    expect(getChordOffsets(2, 0, 0)).toEqual([0, 1]);
  });

  it('returns second shape for stack of 2', () => {
    // Second shape for size 2 is [0, 2]
    expect(getChordOffsets(2, 1, 0)).toEqual([0, 2]);
  });

  it('wraps shape index around', () => {
    // Size 2 has 2 shapes, so index 2 wraps to 0
    expect(getChordOffsets(2, 2, 0)).toEqual(getChordOffsets(2, 0, 0));
    expect(getChordOffsets(2, 3, 0)).toEqual(getChordOffsets(2, 1, 0));
  });

  it('handles negative shape index wrapping', () => {
    // Size 2 has 2 shapes, index -1 wraps to 1
    expect(getChordOffsets(2, -1, 0)).toEqual(getChordOffsets(2, 1, 0));
    expect(getChordOffsets(2, -2, 0)).toEqual(getChordOffsets(2, 0, 0));
  });

  it('applies inversion to shape', () => {
    // Size 3, shape 0 = [0, 1, 2], inversion 1
    const result = getChordOffsets(3, 0, 1);
    expect(result).toEqual(invertShape([0, 1, 2], 1));
  });

  it('applies negative inversion to shape', () => {
    // Size 3, shape 0 = [0, 1, 2], inversion -1
    const result = getChordOffsets(3, 0, -1);
    expect(result).toEqual(invertShape([0, 1, 2], -1));
  });

  it('combines shape selection and inversion', () => {
    // Size 3, shape 2 = [0, 2, 3], inversion 1
    const shapes = getShapesForSize(3);
    const result = getChordOffsets(3, 2, 1);
    expect(result).toEqual(invertShape(shapes[2], 1));
  });

  it('default inversion is 0', () => {
    expect(getChordOffsets(3, 0)).toEqual(getChordOffsets(3, 0, 0));
  });
});

// ============ Chord Expansion in renderEventsToArray ============

describe('renderEventsToArray chord expansion', () => {
  // We import from event.ts to test the rendering side
  // Using dynamic import to avoid pulling in crypto.randomUUID at module level
  let createNoteEvent: typeof import('./event').createNoteEvent;
  let renderEventsToArray: typeof import('./event').renderEventsToArray;

  beforeAll(async () => {
    // Polyfill crypto.randomUUID for Node test env
    if (typeof globalThis.crypto === 'undefined') {
      const { randomUUID } = await import('node:crypto');
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID },
      });
    }
    const eventModule = await import('./event');
    createNoteEvent = eventModule.createNoteEvent;
    renderEventsToArray = eventModule.renderEventsToArray;
  });

  it('single note produces one rendered note', () => {
    const event = createNoteEvent(0, 0, 120);
    event.chordStackSize = 1;
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.length).toBe(1);
    expect(rendered[0].chordOffset).toBe(0);
  });

  it('chord of 2 produces two rendered notes', () => {
    const event = createNoteEvent(5, 0, 120);
    event.chordStackSize = 2;
    event.chordShapeIndex = 0; // [0, 1]
    event.chordInversion = 0;
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.length).toBe(2);
    expect(rendered[0].row).toBe(5);     // base note
    expect(rendered[0].chordOffset).toBe(0);
    expect(rendered[1].row).toBe(6);     // base + 1
    expect(rendered[1].chordOffset).toBe(1);
  });

  it('chord of 3 with first shape produces three rendered notes', () => {
    const event = createNoteEvent(10, 0, 120);
    event.chordStackSize = 3;
    event.chordShapeIndex = 0; // [0, 1, 2]
    event.chordInversion = 0;
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.length).toBe(3);
    expect(rendered.map(r => r.row)).toEqual([10, 11, 12]);
    expect(rendered.map(r => r.chordOffset)).toEqual([0, 1, 2]);
  });

  it('chord with repeats expands both dimensions', () => {
    const event = createNoteEvent(5, 0, 60, 3, 120);
    event.chordStackSize = 2;
    event.chordShapeIndex = 0; // [0, 1]
    event.chordInversion = 0;
    const rendered = renderEventsToArray([event], 1920);
    // 3 repeats × 2 chord voices = 6 rendered notes
    expect(rendered.length).toBe(6);
  });

  it('rendered IDs encode repeat index and chord offset', () => {
    const event = createNoteEvent(0, 0, 60, 2, 120);
    event.chordStackSize = 2;
    event.chordShapeIndex = 0; // [0, 1]
    const rendered = renderEventsToArray([event], 1920);
    // Should have IDs like eventId:repeatIndex:chordOffset
    const ids = rendered.map(r => {
      const parts = r.id.split(':');
      return { repeatIndex: parseInt(parts[parts.length - 2]), chordOffset: parseInt(parts[parts.length - 1]) };
    });
    expect(ids).toEqual([
      { repeatIndex: 0, chordOffset: 0 },
      { repeatIndex: 0, chordOffset: 1 },
      { repeatIndex: 1, chordOffset: 0 },
      { repeatIndex: 1, chordOffset: 1 },
    ]);
  });

  it('chord with inversion offsets rows correctly', () => {
    const event = createNoteEvent(5, 0, 120);
    event.chordStackSize = 3;
    event.chordShapeIndex = 0; // [0, 1, 2]
    event.chordInversion = 1; // invertShape([0,1,2], 1) = [0, 1, 6]
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.map(r => r.row)).toEqual([5, 6, 11]);
    expect(rendered.map(r => r.chordOffset)).toEqual([0, 1, 6]);
  });

  it('chord with modulation offsets all voices', () => {
    const event = createNoteEvent(5, 0, 120);
    event.chordStackSize = 2;
    event.chordShapeIndex = 0; // [0, 1]
    event.modulate = [3]; // +3 half steps
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.map(r => r.row)).toEqual([8, 9]); // 5+3, 5+3+1
  });

  it('chord voices are clamped to min/max row', () => {
    const event = createNoteEvent(127, 0, 120);
    event.chordStackSize = 3;
    event.chordShapeIndex = 0; // [0, 1, 2]
    const rendered = renderEventsToArray([event], 1920, -128, 128);
    expect(rendered.map(r => r.row)).toEqual([127, 128, 128]); // last two clamped
  });

  it('all rendered notes share same sourceId', () => {
    const event = createNoteEvent(0, 0, 120);
    event.chordStackSize = 3;
    const rendered = renderEventsToArray([event], 1920);
    for (const r of rendered) {
      expect(r.sourceId).toBe(event.id);
    }
  });

  it('disabled events produce no rendered notes even with chords', () => {
    const event = createNoteEvent(0, 0, 120);
    event.chordStackSize = 3;
    event.enabled = false;
    const rendered = renderEventsToArray([event], 1920);
    expect(rendered.length).toBe(0);
  });
});
