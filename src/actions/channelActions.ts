import { getSequencerStore } from '../store/sequencerStore';

/**
 * Set the current active channel
 */
export function setCurrentChannel(channel: number): void {
  getSequencerStore()._setCurrentChannel(channel);
}

/**
 * Set pattern for a channel (queues if playing)
 */
export function setChannelPattern(channel: number, pattern: number): void {
  const store = getSequencerStore();

  if (store.isPlaying && store.currentPatterns[channel] !== pattern) {
    // Queue the pattern
    const newQueued = [...store.queuedPatterns];
    newQueued[channel] = newQueued[channel] === pattern ? null : pattern;
    store._setQueuedPatterns(newQueued);
  } else {
    // Switch immediately
    const newPatterns = [...store.currentPatterns];
    newPatterns[channel] = pattern;
    store._setCurrentPatterns(newPatterns);

    // Clear queue for this channel
    const newQueued = [...store.queuedPatterns];
    newQueued[channel] = null;
    store._setQueuedPatterns(newQueued);
  }
}

/**
 * Toggle mute for a channel
 */
export function toggleMute(channel: number): void {
  const store = getSequencerStore();
  const newMuted = [...store.mutedChannels];
  newMuted[channel] = !newMuted[channel];
  store._setMutedChannels(newMuted);
}

/**
 * Toggle solo for a channel
 */
export function toggleSolo(channel: number): void {
  const store = getSequencerStore();
  const newSoloed = [...store.soloedChannels];
  newSoloed[channel] = !newSoloed[channel];
  store._setSoloedChannels(newSoloed);
}
