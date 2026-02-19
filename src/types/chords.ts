// ============ Chord Shapes & Inversions ============
// Shapes and inversions are independent axes:
//   - chordShapeIndex cycles through shapes (Cmd+Shift+Up/Down)
//   - chordInversion applies inversions to the current shape (Shift+Up/Down)

const DIATONIC_OCTAVE = 7;

/**
 * Generate all chord shapes of size N starting from 0.
 * Each shape is a strictly ascending sequence [0, a, b, ...].
 * Max gap between any two adjacent notes is maxGap (default 2).
 * Sorted by total span (compact → wide), then lexicographically.
 */
function generateShapes(size: number, maxGap: number = 2): number[][] {
  if (size === 1) return [[0]];

  const results: number[][] = [];
  const maxSpan = maxGap * (size - 1);

  // Generate all ascending combos [0, ...] of length `size` up to maxSpan
  function recurse(
    current: number[],
    lastVal: number,
    remaining: number,
  ): void {
    if (remaining === 0) {
      results.push(current);
      return;
    }
    for (let next = lastVal + 1; next <= maxSpan; next++) {
      recurse([...current, next], next, remaining - 1);
    }
  }

  recurse([0], 0, size - 1);

  // Sort by total span (compact first), then lexicographically
  results.sort((a, b) => {
    const spanA = a[a.length - 1];
    const spanB = b[b.length - 1];
    if (spanA !== spanB) return spanA - spanB;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  });

  return results;
}

// Pre-compute shapes for sizes 1-5
const SHAPE_CACHE: number[][][] = [];
for (let n = 0; n <= 5; n++) {
  SHAPE_CACHE[n] = n <= 1 ? [[0]] : generateShapes(n);
}

/**
 * Get all available shapes for a given stack size (1-5).
 */
export function getShapesForSize(stackSize: number): number[][] {
  const clamped = Math.max(1, Math.min(5, stackSize));
  return SHAPE_CACHE[clamped];
}

/**
 * Get the number of shapes for a given stack size.
 */
export function getShapeCount(stackSize: number): number {
  return getShapesForSize(stackSize).length;
}

/**
 * Apply an inversion to a shape. Positive inversion shifts the bottom note
 * up by octaveSize, negative shifts the top note down by octaveSize.
 * Inversion 0 = root position.
 *
 * For a shape of N notes, valid inversions are -(N-1) to +(N-1).
 */
export function invertShape(shape: number[], inversion: number): number[] {
  if (inversion === 0 || shape.length <= 1) return shape;

  const current = [...shape];

  if (inversion > 0) {
    // Upward inversions: shift bottom note up by octaveSize
    for (let i = 0; i < inversion; i++) {
      const bottom = current.shift()!;
      current.push(bottom + DIATONIC_OCTAVE);
    }
  } else {
    // Downward inversions: shift top note down by octaveSize
    for (let i = 0; i < -inversion; i++) {
      const top = current.pop()!;
      current.unshift(top - DIATONIC_OCTAVE);
    }
  }

  // Normalize so minimum is 0
  const min = Math.min(...current);
  return current.map((v) => v - min);
}

/**
 * Get the chord offsets for a given stack size, shape index, and inversion.
 * Shape index wraps around the available shapes.
 */
export function getChordOffsets(
  stackSize: number,
  shapeIndex: number,
  inversion: number = 0,
): number[] {
  const shapes = getShapesForSize(stackSize);
  const idx = ((shapeIndex % shapes.length) + shapes.length) % shapes.length;
  const shape = shapes[idx];
  return invertShape(shape, inversion);
}

/**
 * Get the max inversion value for a given stack size (number of notes - 1).
 */
export function getMaxInversion(stackSize: number): number {
  return Math.max(0, stackSize - 1);
}
