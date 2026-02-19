import { getSequencerStore } from '../store/sequencerStore';
import { syncWasmLoops } from '../store/tickLookupCache';

/**
 * Set loop boundaries for a pattern
 */
export function setPatternLoop(
  channel: number,
  pattern: number,
  start: number,
  length: number
): void {
  const store = getSequencerStore();
  const newLoops = store.patternLoops.map((channelLoops, chIdx) =>
    chIdx === channel
      ? channelLoops.map((loop, pIdx) =>
          pIdx === pattern ? { start, length } : loop
        )
      : channelLoops
  );
  store._setPatternLoops(newLoops);
  syncWasmLoops();
}
