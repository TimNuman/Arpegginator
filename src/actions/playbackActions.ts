import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { getNoteLength, getRepeatAmount, getRepeatSpace, getVelocityAtRepeat, type GridState } from '../types/grid';

// Interval reference for internal playback
let playbackInterval: number | null = null;

// Callback reference for step trigger
let stepTriggerCallback: ((channel: number, row: number, step: number, noteLength: number, velocity: number) => void) | null = null;

/**
 * Set the step trigger callback (called when a note should play)
 */
export function setStepTriggerCallback(
  callback: ((channel: number, row: number, step: number, noteLength: number, velocity: number) => void) | null
): void {
  stepTriggerCallback = callback;
}

/**
 * Get notes that should play at a given step (including repeats)
 */
function getNotesAtStep(
  pattern: GridState,
  step: number,
  loopStart: number,
  loopEnd: number
): { row: number; length: number; velocity: number }[] {
  const notes: { row: number; length: number; velocity: number }[] = [];

  for (let row = 0; row < pattern.length; row++) {
    for (let col = loopStart; col <= step; col++) {
      const noteValue = pattern[row][col];
      if (noteValue === null || !noteValue.enabled) continue;

      const length = getNoteLength(noteValue);
      const repeatAmount = getRepeatAmount(noteValue);
      const repeatSpace = getRepeatSpace(noteValue);

      for (let r = 0; r < repeatAmount; r++) {
        const playStep = col + r * repeatSpace;
        if (playStep === step && playStep < loopEnd) {
          notes.push({ row, length, velocity: getVelocityAtRepeat(noteValue, r) });
          break;
        }
      }
    }
  }
  return notes;
}

/**
 * Advance the sequencer by one step (tick)
 */
export function tick(): void {
  const store = getSequencerStore();
  const { currentStep, currentPatterns, patternLoops, channels, mutedChannels, soloedChannels } = store;

  const nextStep = currentStep + 1;
  const patternsToSwitch: { channel: number; pattern: number }[] = [];

  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    const patternIdx = currentPatterns[ch];
    const loop = patternLoops[ch][patternIdx];
    const loopEnd = loop.start + loop.length;
    const channelStep =
      loop.start +
      ((((nextStep - loop.start) % loop.length) + loop.length) % loop.length);

    // Check for queued pattern switch at loop boundary
    if (channelStep === loop.start) {
      const queuedPattern = store.queuedPatterns[ch];
      if (queuedPattern !== null) {
        patternsToSwitch.push({ channel: ch, pattern: queuedPattern });
      }
    }

    // Check mute/solo
    const anySoloed = soloedChannels.some((s) => s);
    const shouldPlay = anySoloed
      ? soloedChannels[ch] && !mutedChannels[ch]
      : !mutedChannels[ch];

    // Trigger notes
    if (shouldPlay && stepTriggerCallback && channelStep >= loop.start && channelStep < loopEnd) {
      const notesToPlay = getNotesAtStep(channels[ch][patternIdx], channelStep, loop.start, loopEnd);
      for (const { row, length, velocity } of notesToPlay) {
        stepTriggerCallback(ch, row, channelStep, length, velocity);
      }
    }
  }

  // Apply pattern switches
  if (patternsToSwitch.length > 0) {
    const newPatterns = [...currentPatterns];
    const newQueued = [...store.queuedPatterns];
    for (const { channel, pattern } of patternsToSwitch) {
      newPatterns[channel] = pattern;
      newQueued[channel] = null;
    }
    store._setCurrentPatterns(newPatterns);
    store._setQueuedPatterns(newQueued);
  }

  store._setCurrentStep(nextStep);
}

/**
 * Start internal playback
 */
export function play(): void {
  const store = getSequencerStore();
  if (playbackInterval) return;

  store._setIsPlaying(true);
  store._setIsExternalPlayback(false);

  const intervalMs = ((60 / store.bpm) * 1000) / 4;
  tick();
  playbackInterval = window.setInterval(tick, intervalMs);
}

/**
 * Stop playback and reset
 */
export function stop(): void {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentStep(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}

/**
 * Pause playback (keep position)
 */
function pause(): void {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  getSequencerStore()._setIsPlaying(false);
}

/**
 * Reset playhead to beginning
 */
export function resetPlayhead(): void {
  getSequencerStore()._setCurrentStep(-1);
}

/**
 * Set BPM (and update interval if playing)
 */
export function setBpm(bpm: number): void {
  const store = getSequencerStore();
  store._setBpm(bpm);

  // Update interval if playing internally
  if (store.isPlaying && playbackInterval && !store.isExternalPlayback) {
    clearInterval(playbackInterval);
    const intervalMs = ((60 / bpm) * 1000) / 4;
    playbackInterval = window.setInterval(tick, intervalMs);
  }
}

/**
 * Toggle play/pause
 */
export function togglePlay(): void {
  const store = getSequencerStore();
  if (store.isPlaying) {
    pause();
  } else {
    play();
  }
}

/**
 * External playback (for MIDI sync)
 */
export function playExternal(): void {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  const store = getSequencerStore();
  store._setIsPlaying(true);
  store._setIsExternalPlayback(true);
}

/**
 * External tick (for MIDI clock)
 */
export function externalTick(): void {
  const store = getSequencerStore();
  if (!store.isPlaying) return;
  tick();
}

/**
 * Stop external playback
 */
export function stopExternal(): void {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentStep(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
