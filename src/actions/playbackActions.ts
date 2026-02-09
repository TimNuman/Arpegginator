import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { getNoteLength, getRepeatAmount, getRepeatSpace, getVelocityAtRepeat, getVelocityAtRepeatFill, getVelocityLoopMode, getChanceAtRepeat, getTimingOffsetAtRepeat, getFlamChanceAtRepeat, type GridState } from '../types/grid';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number; // Fixed micro-timing offset as % of step (signed, from timingOffset array)
  flamCount?: number;            // Number of flam grace notes (0 = none)
}

// Interval reference for internal playback
let playbackInterval: number | null = null;

// Callback reference for step trigger
let stepTriggerCallback: ((channel: number, row: number, step: number, noteLength: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;

// Velocity continue mode: tracks cumulative trigger count per note across pattern loops
// Key: "channel:row:col" → cumulative trigger count (shared across all repeats of the note)
const velocityContinueCounters = new Map<string, number>();

/**
 * Get the current cumulative velocity counter for a note.
 */
export function getVelocityContinueCounter(channel: number, row: number, col: number): number {
  const key = `${channel}:${row}:${col}`;
  return velocityContinueCounters.get(key) ?? 0;
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
      const velLoopMode = getVelocityLoopMode(noteValue);

      for (let r = 0; r < repeatAmount; r++) {
        const playStep = col + r * repeatSpace;
        if (playStep === step && playStep < loopEnd) {
          // Resolve velocity
          let velocity: number;
          if (velLoopMode === "continue") {
            const key = `${channel}:${row}:${col}`;
            const count = velocityContinueCounters.get(key) ?? 0;
            velocity = getVelocityAtRepeat(noteValue, count);
            velocityContinueCounters.set(key, count + 1);
          } else if (velLoopMode === "fill") {
            velocity = getVelocityAtRepeatFill(noteValue, r);
          } else {
            velocity = getVelocityAtRepeat(noteValue, r);
          }

          // Resolve chance (fixed per-repeat, no loop modes)
          const chance = getChanceAtRepeat(noteValue, r);

          // Roll against chance — skip note if fails
          if (chance < 100 && Math.random() * 100 >= chance) {
            break;
          }

          // Build extras for timing offset and flam
          const extras: StepTriggerExtras = {};

          // Timing offset: fixed micro-timing as % of step (signed value)
          const timingOffsetPct = getTimingOffsetAtRepeat(noteValue, r);
          if (timingOffsetPct !== 0) {
            extras.timingOffsetPercent = timingOffsetPct;
          }

          // Flam: roll against flam probability
          const flamProb = getFlamChanceAtRepeat(noteValue, r);
          if (flamProb > 0 && Math.random() * 100 < flamProb) {
            extras.flamCount = 1; // Default 1 grace note, configurable later
          }

          const hasExtras = extras.timingOffsetPercent !== undefined || extras.flamCount !== undefined;
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
  velocityContinueCounters.clear();
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
  velocityContinueCounters.clear();
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentStep(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
