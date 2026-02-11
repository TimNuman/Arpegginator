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

// Callback reference for note-off (called when a note's duration expires)
let noteOffCallback: ((channel: number, midiNote: number) => void) | null = null;

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

// Active notes: notes that actually fired (survived chance roll)
// Key: "channel:row" → { start, end, midiNote } step range (inclusive) + actual MIDI note for note-off
const activeNotes = new Map<string, { start: number; end: number; midiNote: number }>();

/**
 * Check if a note is actively playing at a given step (survived hit chance roll).
 */
export function isNoteActive(ch: number, row: number, step: number): boolean {
  const entry = activeNotes.get(`${ch}:${row}`);
  return entry !== undefined && step >= entry.start && step <= entry.end;
}

// Sub-modes to pre-compute previews for at loop boundaries
const PREVIEW_SUB_MODES: ModifySubMode[] = ["hit", "velocity", "modulate", "timing", "flam"];

// Pre-computed sub-mode values for every note instance in the current loop cycle
// Key: "subMode:channel:row:playStep" → value
const subModePreview = new Map<string, number>();

/**
 * Get the pre-computed sub-mode value for a note instance during playback.
 */
export function getSubModePreview(subMode: ModifySubMode, ch: number, row: number, playStep: number): number | undefined {
  return subModePreview.get(`${subMode}:${ch}:${row}:${playStep}`);
}

// Backwards-compatible alias
export function getHitChancePreview(ch: number, row: number, playStep: number): number | undefined {
  return getSubModePreview("hit", ch, row, playStep);
}

// Snapshot of continue counters at loop start for preview computation
// Key: "subMode:channel:row:col" → counter value at loop boundary
const continueCounterSnapshots = new Map<string, number>();

/**
 * Pre-compute sub-mode previews for a single channel.
 */
function computePreviewForChannel(ch: number): void {
  // Clear existing entries for this channel (match "subMode:ch:" prefix)
  const prefixes = PREVIEW_SUB_MODES.map(sm => `${sm}:${ch}:`);
  for (const key of subModePreview.keys()) {
    if (prefixes.some(p => key.startsWith(p))) subModePreview.delete(key);
  }

  const store = getSequencerStore();
  const patternIdx = store.currentPatterns[ch];
  const loop = store.patternLoops[ch][patternIdx];
  const loopEnd = loop.start + loop.length;
  const pattern = store.channels[ch][patternIdx];

  for (let row = 0; row < pattern.length; row++) {
    for (let col = loop.start; col < loopEnd; col++) {
      const noteValue = pattern[row][col];
      if (noteValue === null || !noteValue.enabled) continue;

      const repeatAmount = getRepeatAmount(noteValue);
      const repeatSpace = getRepeatSpace(noteValue);

      for (const subMode of PREVIEW_SUB_MODES) {
        const loopMode = getSubModeLoopMode(noteValue, subMode);

        // Get counter snapshot for continue mode
        const snapshotKey = `${subMode}:${ch}:${row}:${col}`;
        const counterSnapshot = continueCounterSnapshots.get(snapshotKey) ?? getContinueCounter(subMode, ch, row, col);

        for (let r = 0; r < repeatAmount; r++) {
          const playStep = col + r * repeatSpace;
          if (playStep < loop.start || playStep >= loopEnd) continue;

          let val: number;
          if (loopMode === "continue") {
            val = getSubModeValueAtRepeat(noteValue, subMode, counterSnapshot + r);
          } else if (loopMode === "fill") {
            val = getSubModeValueAtRepeatFill(noteValue, subMode, r);
          } else {
            val = getSubModeValueAtRepeat(noteValue, subMode, r);
          }

          subModePreview.set(`${subMode}:${ch}:${row}:${playStep}`, val);
        }
      }
    }
  }
}

/**
 * Snapshot continue counters and compute previews for a channel at loop boundary.
 */
function snapshotAndPreviewChannel(ch: number): void {
  const store = getSequencerStore();
  const patternIdx = store.currentPatterns[ch];
  const loop = store.patternLoops[ch][patternIdx];
  const loopEnd = loop.start + loop.length;
  const pattern = store.channels[ch][patternIdx];

  // Snapshot current continue counters for all preview sub-modes
  const prefixes = PREVIEW_SUB_MODES.map(sm => `${sm}:${ch}:`);
  for (const key of continueCounterSnapshots.keys()) {
    if (prefixes.some(p => key.startsWith(p))) continueCounterSnapshots.delete(key);
  }
  for (let row = 0; row < pattern.length; row++) {
    for (let col = loop.start; col < loopEnd; col++) {
      const noteValue = pattern[row][col];
      if (noteValue === null || !noteValue.enabled) continue;
      for (const subMode of PREVIEW_SUB_MODES) {
        const snapshotKey = `${subMode}:${ch}:${row}:${col}`;
        continueCounterSnapshots.set(snapshotKey, getContinueCounter(subMode, ch, row, col));
      }
    }
  }

  computePreviewForChannel(ch);
}

/**
 * Compute previews for all channels (called on play start).
 */
function computePreviewAll(): void {
  subModePreview.clear();
  continueCounterSnapshots.clear();
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    computePreviewForChannel(ch);
  }
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
 * Set the note-off callback (called when a note's duration expires on tick)
 */
export function setNoteOffCallback(
  callback: ((channel: number, midiNote: number) => void) | null
): void {
  noteOffCallback = callback;
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
          // Resolve ALL sub-mode values upfront so continue counters stay in sync
          const velocity = resolveSubModeValue(noteValue, "velocity", r, channel, row, col);
          const chance = resolveSubModeValue(noteValue, "hit", r, channel, row, col);
          const timingOffsetPct = resolveSubModeValue(noteValue, "timing", r, channel, row, col);
          const flamProb = resolveSubModeValue(noteValue, "flam", r, channel, row, col);
          const modulateVal = resolveSubModeValue(noteValue, "modulate", r, channel, row, col);

          // Roll against chance — skip note if fails
          if (chance < 100 && Math.random() * 100 >= chance) {
            break;
          }

          // Build extras
          const extras: StepTriggerExtras = {};

          if (timingOffsetPct !== 0) {
            extras.timingOffsetPercent = timingOffsetPct;
          }

          if (flamProb > 0 && Math.random() * 100 < flamProb) {
            extras.flamCount = 1;
          }

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

    // 1. Loop reset: release + clear activeNotes, snapshot counters, recompute preview, check queued patterns
    if (channelStep === loop.start) {
      for (const [key, entry] of activeNotes) {
        if (key.startsWith(`${ch}:`)) {
          if (noteOffCallback) noteOffCallback(ch, entry.midiNote);
          activeNotes.delete(key);
        }
      }
      snapshotAndPreviewChannel(ch);

      const queuedPattern = store.queuedPatterns[ch];
      if (queuedPattern !== null) {
        patternsToSwitch.push({ channel: ch, pattern: queuedPattern });
      }
    }

    // 2. Prune expired activeNotes for this channel — fire note-off
    for (const [key, entry] of activeNotes) {
      if (key.startsWith(`${ch}:`) && channelStep > entry.end) {
        if (noteOffCallback) noteOffCallback(ch, entry.midiNote);
        activeNotes.delete(key);
      }
    }

    // 3. Check mute/solo
    const anySoloed = soloedChannels.some((s) => s);
    const shouldPlay = anySoloed
      ? soloedChannels[ch] && !mutedChannels[ch]
      : !mutedChannels[ch];

    // 4. Trigger notes and populate activeNotes
    if (shouldPlay && stepTriggerCallback && channelStep >= loop.start && channelStep < loopEnd) {
      const notesToPlay = getNotesAtStep(channels[ch][patternIdx], channelStep, loop.start, loopEnd, ch);
      for (const { row, length, velocity, extras } of notesToPlay) {
        const midiNote = row + (extras?.modulateHalfSteps ?? 0);
        // Release any existing note on the same row before retriggering
        const activeKey = `${ch}:${row}`;
        const existing = activeNotes.get(activeKey);
        if (existing && noteOffCallback) noteOffCallback(ch, existing.midiNote);
        activeNotes.set(activeKey, { start: channelStep, end: channelStep + length - 1, midiNote });
        stepTriggerCallback(ch, row, channelStep, length, velocity, extras);
      }
    }
  }

  // Apply pattern switches and recompute preview for switched channels
  if (patternsToSwitch.length > 0) {
    const newPatterns = [...currentPatterns];
    const newQueued = [...store.queuedPatterns];
    for (const { channel, pattern } of patternsToSwitch) {
      newPatterns[channel] = pattern;
      newQueued[channel] = null;
    }
    store._setCurrentPatterns(newPatterns);
    store._setQueuedPatterns(newQueued);

    for (const { channel } of patternsToSwitch) {
      computePreviewForChannel(channel);
    }
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

  computePreviewAll();

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
  // Release all active notes
  if (noteOffCallback) {
    for (const [key, entry] of activeNotes) {
      const ch = parseInt(key.split(":")[0], 10);
      noteOffCallback(ch, entry.midiNote);
    }
  }
  continueCounters.clear();
  activeNotes.clear();
  subModePreview.clear();
  continueCounterSnapshots.clear();
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

  computePreviewAll();
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
  // Release all active notes
  if (noteOffCallback) {
    for (const [key, entry] of activeNotes) {
      const ch = parseInt(key.split(":")[0], 10);
      noteOffCallback(ch, entry.midiNote);
    }
  }
  continueCounters.clear();
  activeNotes.clear();
  subModePreview.clear();
  continueCounterSnapshots.clear();
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentStep(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
