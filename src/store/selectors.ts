import { useMemo } from 'react';
import { useSequencerStore, type SequencerState } from './sequencerStore';
import type { PatternData, Subdivision } from '../types/event';
import { TICKS_PER_QUARTER } from '../types/event';

// ============ Selector Functions ============

// Current channel's current pattern data
const selectPatternData = (state: SequencerState): PatternData =>
  state.patterns[state.currentChannel][state.currentPatterns[state.currentChannel]];

// Current pattern index for current channel
const selectCurrentPattern = (state: SequencerState) =>
  state.currentPatterns[state.currentChannel];

// Current loop for current channel's current pattern
const selectCurrentLoop = (state: SequencerState) => {
  const pattern = state.currentPatterns[state.currentChannel];
  return state.patternLoops[state.currentChannel][pattern];
};

// Pulse beat indicator (every quarter note in ticks)
const selectIsPulseBeat = (state: SequencerState) =>
  state.currentTick >= 0 && state.currentTick % TICKS_PER_QUARTER === 0;

// Current zoom level
const selectZoom = (state: SequencerState): Subdivision =>
  state.view.zoom;

// ============ Hook Wrappers for Common Selectors ============

// These use stable references - no shallow comparison needed
export const usePatternData = () => useSequencerStore(selectPatternData);
export const useCurrentPattern = () => useSequencerStore(selectCurrentPattern);
export const useCurrentLoop = () => useSequencerStore(selectCurrentLoop);
export const useIsPulseBeat = () => useSequencerStore(selectIsPulseBeat);
export const useZoom = () => useSequencerStore(selectZoom);

// Playback state selectors (primitives)
export const useIsPlaying = () => useSequencerStore((s) => s.isPlaying);

// Channel state selectors (stable array references from immer)
export const useCurrentPatterns = () => useSequencerStore((s) => s.currentPatterns);
export const useQueuedPatterns = () => useSequencerStore((s) => s.queuedPatterns);
export const useMutedChannels = () => useSequencerStore((s) => s.mutedChannels);
export const useSoloedChannels = () => useSequencerStore((s) => s.soloedChannels);

// ============ Computed Values using useMemo ============

// Which patterns have notes for each channel
export function useAllPatternsHaveNotes(): boolean[][] {
  const patterns = useSequencerStore((s) => s.patterns);

  return useMemo(() => {
    return patterns.map((ch) =>
      ch.map((pattern) => pattern.events.length > 0)
    );
  }, [patterns]);
}

// Which channels are playing at current tick
export function useChannelsPlayingNow(): boolean[] {
  const patterns = useSequencerStore((s) => s.patterns);
  const currentTick = useSequencerStore((s) => s.currentTick);
  const currentPatterns = useSequencerStore((s) => s.currentPatterns);
  const patternLoops = useSequencerStore((s) => s.patternLoops);

  return useMemo(() => {
    if (currentTick < 0) return [false, false, false, false, false, false, false, false];

    return patterns.map((_ch, chIdx) => {
      const patternIdx = currentPatterns[chIdx];
      const loop = patternLoops[chIdx][patternIdx];
      const channelTick =
        loop.start +
        ((((currentTick - loop.start) % loop.length) + loop.length) % loop.length);

      const patternData = patterns[chIdx][patternIdx];

      // Check if any event is playing at channelTick (covers start or continuation)
      for (const event of patternData.events) {
        if (!event.enabled) continue;
        for (let r = 0; r < event.repeatAmount; r++) {
          const noteStart = event.position + r * event.repeatSpace;
          const noteEnd = noteStart + event.length;
          if (noteStart >= loop.start + loop.length) break;
          if (channelTick >= noteStart && channelTick < noteEnd) {
            return true;
          }
        }
      }
      return false;
    });
  }, [patterns, currentTick, currentPatterns, patternLoops]);
}
