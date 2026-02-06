import { getSequencerStore, ROWS, COLS, DEFAULT_LOOP_START, DEFAULT_LOOP_LENGTH } from '../store/sequencerStore';
import type { GridState } from '../types/grid';

/**
 * Copy current pattern to target pattern slot
 */
export function copyPatternTo(targetPattern: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, channels, patternLoops } = store;
  const currentPatternIdx = currentPatterns[currentChannel];

  // Deep copy the grid
  const sourceGrid = channels[currentChannel][currentPatternIdx];
  const newGrid: GridState = sourceGrid.map(row => [...row]);
  store._updatePattern(currentChannel, targetPattern, newGrid);

  // Copy loop settings
  const sourceLoop = patternLoops[currentChannel][currentPatternIdx];
  const newLoops = patternLoops.map((channelLoops, chIdx) =>
    chIdx === currentChannel
      ? channelLoops.map((loop, pIdx) =>
          pIdx === targetPattern ? { ...sourceLoop } : loop
        )
      : channelLoops
  );
  store._setPatternLoops(newLoops);
}

/**
 * Clear current pattern
 */
export function clearGrid(): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, patternLoops } = store;
  const pattern = currentPatterns[currentChannel];

  // Create empty grid
  const emptyGrid: GridState = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  store._updatePattern(currentChannel, pattern, emptyGrid);

  // Reset loop
  const newLoops = patternLoops.map((channelLoops, chIdx) =>
    chIdx === currentChannel
      ? channelLoops.map((loop, pIdx) =>
          pIdx === pattern
            ? { start: DEFAULT_LOOP_START, length: DEFAULT_LOOP_LENGTH }
            : loop
        )
      : channelLoops
  );
  store._setPatternLoops(newLoops);
}

