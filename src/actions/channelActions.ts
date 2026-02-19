import { getSequencerStore } from '../store/sequencerStore';
import { syncWasmMuteSolo, syncWasmQueuedPatterns, syncWasmCurrentPatterns } from '../store/tickLookupCache';

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
    syncWasmQueuedPatterns();
  } else {
    // Switch immediately
    const newPatterns = [...store.currentPatterns];
    newPatterns[channel] = pattern;
    store._setCurrentPatterns(newPatterns);

    // Clear queue for this channel
    const newQueued = [...store.queuedPatterns];
    newQueued[channel] = null;
    store._setQueuedPatterns(newQueued);
    syncWasmCurrentPatterns();
    syncWasmQueuedPatterns();
  }
}

/**
 * Toggle mute for a channel.
 * A channel can't be muted and soloed at the same time — muting unsolos.
 */
export function toggleMute(channel: number): void {
  const store = getSequencerStore();
  const newMuted = [...store.mutedChannels];
  newMuted[channel] = !newMuted[channel];
  store._setMutedChannels(newMuted);

  // Muting a soloed channel unsolos it
  if (newMuted[channel] && store.soloedChannels[channel]) {
    const newSoloed = [...store.soloedChannels];
    newSoloed[channel] = false;
    store._setSoloedChannels(newSoloed);
  }
  syncWasmMuteSolo();
}

/**
 * Toggle solo for a channel.
 * A channel can't be soloed and muted at the same time — soloing unmutes.
 * Unsoloing also unmutes (never goes back to muted state).
 */
export function toggleSolo(channel: number): void {
  const store = getSequencerStore();
  const newSoloed = [...store.soloedChannels];
  newSoloed[channel] = !newSoloed[channel];
  store._setSoloedChannels(newSoloed);

  // Always unmute when toggling solo (both on and off)
  if (store.mutedChannels[channel]) {
    const newMuted = [...store.mutedChannels];
    newMuted[channel] = false;
    store._setMutedChannels(newMuted);
  }
  syncWasmMuteSolo();
}
