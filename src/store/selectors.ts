import { useMemo } from 'react';
import { useSequencerStore, type SequencerState } from './sequencerStore';
import { getNoteLength, getRepeatAmount, getRepeatSpace, isNoteEnabled, renderNotesToArray, type RenderedNote } from '../types/grid';

// ============ Selector Functions ============

// Current channel's current pattern grid
export const selectGridState = (state: SequencerState) =>
  state.channels[state.currentChannel][state.currentPatterns[state.currentChannel]];

// Current pattern index for current channel
export const selectCurrentPattern = (state: SequencerState) =>
  state.currentPatterns[state.currentChannel];

// Current loop for current channel's current pattern
export const selectCurrentLoop = (state: SequencerState) => {
  const pattern = state.currentPatterns[state.currentChannel];
  return state.patternLoops[state.currentChannel][pattern];
};

// Pulse beat indicator (every 4 steps)
export const selectIsPulseBeat = (state: SequencerState) =>
  state.currentStep >= 0 && state.currentStep % 4 === 0;

// ============ Hook Wrappers for Common Selectors ============

// These use stable references - no shallow comparison needed
export const useGridState = () => useSequencerStore(selectGridState);
export const useCurrentPattern = () => useSequencerStore(selectCurrentPattern);
export const useCurrentLoop = () => useSequencerStore(selectCurrentLoop);
export const useIsPulseBeat = () => useSequencerStore(selectIsPulseBeat);

// View state selectors (stable references)
export const useSelectedNote = () => useSequencerStore((s) => s.view.selectedNote);
export const useRowOffsets = () => useSequencerStore((s) => s.view.rowOffsets);
export const useColOffset = () => useSequencerStore((s) => s.view.colOffset);
export const useUiMode = () => useSequencerStore((s) => s.view.uiMode);

// Playback state selectors (primitives)
export const useIsPlaying = () => useSequencerStore((s) => s.isPlaying);
export const useCurrentStep = () => useSequencerStore((s) => s.currentStep);
export const useBpm = () => useSequencerStore((s) => s.bpm);

// Channel state selectors (stable array references from immer)
export const useCurrentChannel = () => useSequencerStore((s) => s.currentChannel);
export const useCurrentPatterns = () => useSequencerStore((s) => s.currentPatterns);
export const useQueuedPatterns = () => useSequencerStore((s) => s.queuedPatterns);
export const useMutedChannels = () => useSequencerStore((s) => s.mutedChannels);
export const useSoloedChannels = () => useSequencerStore((s) => s.soloedChannels);
export const usePatternLoops = () => useSequencerStore((s) => s.patternLoops);

// ============ Computed Values using useMemo ============

// Which channels have any notes
export function useChannelsHaveNotes(): boolean[] {
  const channels = useSequencerStore((s) => s.channels);

  return useMemo(() => {
    return channels.map((ch) =>
      ch.some((pattern) =>
        pattern.some((row) => row.some((cell) => getNoteLength(cell) > 0))
      )
    );
  }, [channels]);
}

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

// ============ Heavy Computed Values ============

// Rendered notes - computed in hook with useMemo
export const selectRenderedNotes = (state: SequencerState): RenderedNote[] => {
  const grid = selectGridState(state);
  return renderNotesToArray(grid, 64);
};

// Custom hook that memoizes rendered notes properly using useMemo
export function useRenderedNotes(): RenderedNote[] {
  const grid = useGridState();

  return useMemo(() => {
    return renderNotesToArray(grid, 64);
  }, [grid]);
}
