import { useMemo } from 'react';
import { useSequencerStore, type SequencerState } from './sequencerStore';
import { getNoteLength, getRepeatAmount, getRepeatSpace, isNoteEnabled } from '../types/grid';

// ============ Selector Functions ============

// Current channel's current pattern grid
const selectGridState = (state: SequencerState) =>
  state.channels[state.currentChannel][state.currentPatterns[state.currentChannel]];

// Current pattern index for current channel
const selectCurrentPattern = (state: SequencerState) =>
  state.currentPatterns[state.currentChannel];

// Current loop for current channel's current pattern
const selectCurrentLoop = (state: SequencerState) => {
  const pattern = state.currentPatterns[state.currentChannel];
  return state.patternLoops[state.currentChannel][pattern];
};

// Pulse beat indicator (every 4 steps)
const selectIsPulseBeat = (state: SequencerState) =>
  state.currentStep >= 0 && state.currentStep % 4 === 0;

// ============ Hook Wrappers for Common Selectors ============

// These use stable references - no shallow comparison needed
export const useGridState = () => useSequencerStore(selectGridState);
export const useCurrentPattern = () => useSequencerStore(selectCurrentPattern);
export const useCurrentLoop = () => useSequencerStore(selectCurrentLoop);
export const useIsPulseBeat = () => useSequencerStore(selectIsPulseBeat);

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
  const channels = useSequencerStore((s) => s.channels);

  return useMemo(() => {
    return channels.map((ch) =>
      ch.map((pattern) =>
        pattern.some((row) => row.some((cell) => getNoteLength(cell) > 0))
      )
    );
  }, [channels]);
}

// Which channels are playing at current step
export function useChannelsPlayingNow(): boolean[] {
  const channels = useSequencerStore((s) => s.channels);
  const currentStep = useSequencerStore((s) => s.currentStep);
  const currentPatterns = useSequencerStore((s) => s.currentPatterns);
  const patternLoops = useSequencerStore((s) => s.patternLoops);

  return useMemo(() => {
    if (currentStep < 0) return [false, false, false, false, false, false, false, false];

    return channels.map((ch, chIdx) => {
      const patternIdx = currentPatterns[chIdx];
      const loop = patternLoops[chIdx][patternIdx];
      const channelStep =
        loop.start +
        ((((currentStep - loop.start) % loop.length) + loop.length) % loop.length);

      return ch[patternIdx].some((row) => {
        if (isNoteEnabled(row[channelStep])) return true;
        for (let col = loop.start; col < channelStep; col++) {
          const noteValue = row[col];
          if (!isNoteEnabled(noteValue)) continue;
          const noteLength = getNoteLength(noteValue);
          if (noteLength > 0) {
            if (col + noteLength > channelStep) return true;
            const repeatAmount = getRepeatAmount(noteValue);
            const repeatSpace = getRepeatSpace(noteValue);
            if (repeatAmount > 1) {
              for (let r = 1; r < repeatAmount; r++) {
                const repeatStart = col + r * repeatSpace;
                if (channelStep >= repeatStart && channelStep < repeatStart + noteLength) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      });
    });
  }, [channels, currentStep, currentPatterns, patternLoops]);
}
