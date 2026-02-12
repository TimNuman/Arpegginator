import { getSequencerStore, DEFAULT_LOOP_TICKS, DEFAULT_PATTERN_TICKS, DEFAULT_SUBDIVISION } from '../store/sequencerStore';
import { invalidateLookup } from '../store/tickLookupCache';
import { createEmptyPatternData, type PatternData } from '../types/event';

/**
 * Copy current pattern to target pattern slot
 */
export function copyPatternTo(targetPattern: number): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, patterns, patternLoops } = store;
  const currentPatternIdx = currentPatterns[currentChannel];

  // Deep copy the pattern data (events with new IDs)
  const source = patterns[currentChannel][currentPatternIdx];
  const copied: PatternData = {
    events: source.events.map(e => ({ ...e, id: crypto.randomUUID() })),
    subdivision: source.subdivision,
    lengthTicks: source.lengthTicks,
  };
  store._setPatternData(currentChannel, targetPattern, copied);

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
  invalidateLookup(currentChannel, targetPattern);
}

/**
 * Clear current pattern
 */
export function clearPattern(): void {
  const store = getSequencerStore();
  const { currentChannel, currentPatterns, patternLoops } = store;
  const pattern = currentPatterns[currentChannel];

  // Create empty pattern data
  store._setPatternData(currentChannel, pattern,
    createEmptyPatternData(DEFAULT_SUBDIVISION, DEFAULT_PATTERN_TICKS),
  );

  // Reset loop
  const newLoops = patternLoops.map((channelLoops, chIdx) =>
    chIdx === currentChannel
      ? channelLoops.map((loop, pIdx) =>
          pIdx === pattern
            ? { start: 0, length: DEFAULT_LOOP_TICKS }
            : loop
        )
      : channelLoops
  );
  store._setPatternLoops(newLoops);
  invalidateLookup(currentChannel, pattern);
}
