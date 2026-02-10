import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { getNoteLength, getRepeatAmount, getRepeatSpace, getSubModeLoopMode, getSubModeValueAtRepeat, getSubModeValueAtRepeatFill, type GridState, type ModifySubMode } from '../types/grid';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number; // Fixed micro-timing offset as % of step (signed, from timingOffset array)
  flamCount?: number;            // Number of flam grace notes (0 = none)
  modulateHalfSteps?: number;    // Pitch transposition in half steps (signed)
}

// Interval reference for internal playback
let playbackInterval: number | null = null;

// Callback reference for step trigger
let stepTriggerCallback: ((channel: number, row: number, step: number, noteLength: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;

// Continue mode counters: track cumulative trigger count per note per sub-mode across pattern loops
// Key: "subMode:channel:row:col" → cumulative trigger count
const continueCounters = new Map<string, number>();

/**
 * Get the current cumulative counter for a note's sub-mode.
 */
export function getContinueCounter(subMode: ModifySubMode, channel: number, row: number, col: number): number {
  const key = `${subMode}:${channel}:${row}:${col}`;
  return continueCounters.get(key) ?? 0;
}

/**
 * Increment and return the pre-increment counter value (the index to use).
 */
function incrementContinueCounter(subMode: ModifySubMode, channel: number, row: number, col: number): number {
  const key = `${subMode}:${channel}:${row}:${col}`;
  const count = continueCounters.get(key) ?? 0;
  continueCounters.set(key, count + 1);
  return count;
}

/**
 * Resolve a sub-mode value at a given repeat, respecting loop mode.
 */
function resolveSubModeValue(
  noteValue: Parameters<typeof getSubModeLoopMode>[0] & object,
  subMode: ModifySubMode,
  repeatIndex: number,
  channel: number,
  row: number,
  col: number,
): number {
  const loopMode = getSubModeLoopMode(noteValue, subMode);
  if (loopMode === "continue") {
    const count = incrementContinueCounter(subMode, channel, row, col);
    return getSubModeValueAtRepeat(noteValue, subMode, count);
  } else if (loopMode === "fill") {
    return getSubModeValueAtRepeatFill(noteValue, subMode, repeatIndex);
  } else {
    return getSubModeValueAtRepeat(noteValue, subMode, repeatIndex);
  }
}

/**
 * Set the step trigger callback (called when a note should play)
 */
export function setStepTriggerCallback(
  callback: ((channel: number, row: number, step: number, noteLength: number, velocity: number, extras?: StepTriggerExtras) => void) | null
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
  loopEnd: number,
  channel: number
): { row: number; length: number; velocity: number; extras?: StepTriggerExtras }[] {
  const notes: { row: number; length: number; velocity: number; extras?: StepTriggerExtras }[] = [];

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
          // Resolve all sub-mode values via generic resolver
          const velocity = resolveSubModeValue(noteValue, "velocity", r, channel, row, col);
          const chance = resolveSubModeValue(noteValue, "hit", r, channel, row, col);

          // Roll against chance — skip note if fails
          if (chance < 100 && Math.random() * 100 >= chance) {
            break;
          }

          // Build extras
          const extras: StepTriggerExtras = {};

          const timingOffsetPct = resolveSubModeValue(noteValue, "timing", r, channel, row, col);
          if (timingOffsetPct !== 0) {
            extras.timingOffsetPercent = timingOffsetPct;
          }

          const flamProb = resolveSubModeValue(noteValue, "flam", r, channel, row, col);
          if (flamProb > 0 && Math.random() * 100 < flamProb) {
            extras.flamCount = 1;
          }

          const modulateVal = resolveSubModeValue(noteValue, "modulate", r, channel, row, col);
          if (modulateVal !== 0) {
            extras.modulateHalfSteps = modulateVal;
          }

          const hasExtras = extras.timingOffsetPercent !== undefined || extras.flamCount !== undefined || extras.modulateHalfSteps !== undefined;
          notes.push({ row, length, velocity, extras: hasExtras ? extras : undefined });
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
      const notesToPlay = getNotesAtStep(channels[ch][patternIdx], channelStep, loop.start, loopEnd, ch);
      for (const { row, length, velocity, extras } of notesToPlay) {
        stepTriggerCallback(ch, row, channelStep, length, velocity, extras);
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
  continueCounters.clear();
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
  continueCounters.clear();
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentStep(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
