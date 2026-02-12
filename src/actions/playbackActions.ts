import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { getLookup, invalidateAll } from '../store/tickLookupCache';
import {
  type NoteEvent,
  type ModifySubMode,
  getEventSubModeLoopMode,
  getEventSubModeValueAtRepeat,
  getEventSubModeValueAtRepeatFill,
  TICKS_PER_QUARTER,
} from '../types/event';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number; // Fixed micro-timing offset as % of step (signed)
  flamCount?: number;            // Number of flam grace notes (0 = none)
  modulateHalfSteps?: number;    // Pitch transposition in half steps (signed)
}

// Callback references
let stepTriggerCallback: ((channel: number, row: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;
let noteOffCallback: ((channel: number, midiNote: number) => void) | null = null;

// Playback loop state
let playbackTimerId: ReturnType<typeof setTimeout> | null = null;
let lastFrameTime: number = 0;
let tickAccumulator: number = 0;

// Continue mode counters: track cumulative trigger count per event per sub-mode across pattern loops
// Key: "subMode:ch:eventId" → cumulative trigger count
const continueCounters = new Map<string, number>();

/**
 * Get the current cumulative counter for an event's sub-mode.
 */
export function getContinueCounter(subMode: ModifySubMode, channel: number, eventId: string): number {
  const key = `${subMode}:${channel}:${eventId}`;
  return continueCounters.get(key) ?? 0;
}

/**
 * Increment and return the pre-increment counter value (the index to use).
 */
function incrementContinueCounter(subMode: ModifySubMode, channel: number, eventId: string): number {
  const key = `${subMode}:${channel}:${eventId}`;
  const count = continueCounters.get(key) ?? 0;
  continueCounters.set(key, count + 1);
  return count;
}

// Active notes: notes that actually fired (survived chance roll)
// Key: "channel:eventId:repeatIndex" → { start, end, midiNote }
const activeNotes = new Map<string, { start: number; end: number; midiNote: number }>();

/**
 * Check if a note is actively playing at a given tick.
 */
export function isNoteActive(ch: number, eventId: string, tick: number): boolean {
  for (const [key, entry] of activeNotes) {
    if (key.startsWith(`${ch}:${eventId}:`) && tick >= entry.start && tick <= entry.end) {
      return true;
    }
  }
  return false;
}

// Sub-modes to pre-compute previews for at loop boundaries
const PREVIEW_SUB_MODES: ModifySubMode[] = ["hit", "velocity", "modulate", "timing", "flam"];

// Pre-computed sub-mode values for every event instance in the current loop cycle
// Key: "subMode:channel:eventId:tick" → value
const subModePreview = new Map<string, number>();

/**
 * Get the pre-computed sub-mode value for an event instance during playback.
 */
export function getSubModePreview(subMode: ModifySubMode, ch: number, eventId: string, tick: number): number | undefined {
  return subModePreview.get(`${subMode}:${ch}:${eventId}:${tick}`);
}

// Backwards-compatible alias
export function getHitChancePreview(ch: number, eventId: string, tick: number): number | undefined {
  return getSubModePreview("hit", ch, eventId, tick);
}

// Snapshot of continue counters at loop start for preview computation
const continueCounterSnapshots = new Map<string, number>();

/**
 * Pre-compute sub-mode previews for a single channel.
 */
function computePreviewForChannel(ch: number): void {
  const prefixes = PREVIEW_SUB_MODES.map(sm => `${sm}:${ch}:`);
  for (const key of subModePreview.keys()) {
    if (prefixes.some(p => key.startsWith(p))) subModePreview.delete(key);
  }

  const store = getSequencerStore();
  const patternIdx = store.currentPatterns[ch];
  const loop = store.patternLoops[ch][patternIdx];
  const loopEnd = loop.start + loop.length;
  const patternData = store.patterns[ch][patternIdx];

  for (const event of patternData.events) {
    if (!event.enabled) continue;

    for (const subMode of PREVIEW_SUB_MODES) {
      const loopMode = getEventSubModeLoopMode(event, subMode);
      const snapshotKey = `${subMode}:${ch}:${event.id}`;
      const counterSnapshot = continueCounterSnapshots.get(snapshotKey) ?? getContinueCounter(subMode, ch, event.id);

      for (let r = 0; r < event.repeatAmount; r++) {
        const eventTick = event.position + r * event.repeatSpace;
        if (eventTick < loop.start || eventTick >= loopEnd) continue;

        let val: number;
        if (loopMode === "continue") {
          val = getEventSubModeValueAtRepeat(event, subMode, counterSnapshot + r);
        } else if (loopMode === "fill") {
          val = getEventSubModeValueAtRepeatFill(event, subMode, r);
        } else {
          val = getEventSubModeValueAtRepeat(event, subMode, r);
        }

        subModePreview.set(`${subMode}:${ch}:${event.id}:${eventTick}`, val);
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
  const patternData = store.patterns[ch][patternIdx];

  const prefixes = PREVIEW_SUB_MODES.map(sm => `${sm}:${ch}:`);
  for (const key of continueCounterSnapshots.keys()) {
    if (prefixes.some(p => key.startsWith(p))) continueCounterSnapshots.delete(key);
  }
  for (const event of patternData.events) {
    if (!event.enabled) continue;
    for (const subMode of PREVIEW_SUB_MODES) {
      const snapshotKey = `${subMode}:${ch}:${event.id}`;
      continueCounterSnapshots.set(snapshotKey, getContinueCounter(subMode, ch, event.id));
    }
  }

  computePreviewForChannel(ch);
}

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
  event: NoteEvent,
  subMode: ModifySubMode,
  repeatIndex: number,
  channel: number,
): number {
  const loopMode = getEventSubModeLoopMode(event, subMode);
  if (loopMode === "continue") {
    const count = incrementContinueCounter(subMode, channel, event.id);
    return getEventSubModeValueAtRepeat(event, subMode, count);
  } else if (loopMode === "fill") {
    return getEventSubModeValueAtRepeatFill(event, subMode, repeatIndex);
  } else {
    return getEventSubModeValueAtRepeat(event, subMode, repeatIndex);
  }
}

// ============ Public API ============

export function setStepTriggerCallback(
  callback: ((channel: number, row: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null
): void {
  stepTriggerCallback = callback;
}

export function setNoteOffCallback(
  callback: ((channel: number, midiNote: number) => void) | null
): void {
  noteOffCallback = callback;
}

/**
 * Advance the sequencer by one tick
 */
export function tick(): void {
  const store = getSequencerStore();
  const { currentTick, currentPatterns, patternLoops, mutedChannels, soloedChannels } = store;

  const nextTick = currentTick + 1;
  const patternsToSwitch: { channel: number; pattern: number }[] = [];

  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    const patternIdx = currentPatterns[ch];
    const loop = patternLoops[ch][patternIdx];
    const loopEnd = loop.start + loop.length;
    const channelTick =
      loop.start +
      ((((nextTick - loop.start) % loop.length) + loop.length) % loop.length);

    // 1. Loop reset
    if (channelTick === loop.start) {
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

    // 2. Prune expired activeNotes
    for (const [key, entry] of activeNotes) {
      if (key.startsWith(`${ch}:`) && channelTick > entry.end) {
        if (noteOffCallback) noteOffCallback(ch, entry.midiNote);
        activeNotes.delete(key);
      }
    }

    // 3. Check mute/solo
    const anySoloed = soloedChannels.some((s) => s);
    const shouldPlay = anySoloed
      ? soloedChannels[ch] && !mutedChannels[ch]
      : !mutedChannels[ch];

    // 4. Trigger notes using lookup map
    if (shouldPlay && stepTriggerCallback && channelTick >= loop.start && channelTick < loopEnd) {
      const lookup = getLookup(ch, patternIdx);
      const entries = lookup.get(channelTick);

      if (entries) {
        for (const { event, repeatIndex } of entries) {
          const velocity = resolveSubModeValue(event, "velocity", repeatIndex, ch);
          const chance = resolveSubModeValue(event, "hit", repeatIndex, ch);
          const timingOffsetPct = resolveSubModeValue(event, "timing", repeatIndex, ch);
          const flamProb = resolveSubModeValue(event, "flam", repeatIndex, ch);
          const modulateVal = resolveSubModeValue(event, "modulate", repeatIndex, ch);

          if (chance < 100 && Math.random() * 100 >= chance) {
            continue;
          }

          const extras: StepTriggerExtras = {};
          if (timingOffsetPct !== 0) extras.timingOffsetPercent = timingOffsetPct;
          if (flamProb > 0 && Math.random() * 100 < flamProb) extras.flamCount = 1;
          if (modulateVal !== 0) extras.modulateHalfSteps = modulateVal;

          const hasExtras = extras.timingOffsetPercent !== undefined || extras.flamCount !== undefined || extras.modulateHalfSteps !== undefined;
          const midiNote = event.row + (extras.modulateHalfSteps ?? 0);

          const activeKey = `${ch}:${event.id}:${repeatIndex}`;
          const existing = activeNotes.get(activeKey);
          if (existing && noteOffCallback) noteOffCallback(ch, existing.midiNote);
          activeNotes.set(activeKey, { start: channelTick, end: channelTick + event.length - 1, midiNote });

          stepTriggerCallback(ch, event.row, channelTick, event.length, velocity, hasExtras ? extras : undefined);
        }
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

    for (const { channel } of patternsToSwitch) {
      computePreviewForChannel(channel);
    }
  }

  store._setCurrentTick(nextTick);
}

/**
 * Internal playback loop using setTimeout(1ms) + time accumulator.
 * setTimeout fires ~4x more frequently than requestAnimationFrame (~4ms vs ~16ms),
 * giving much tighter timing for MIDI note triggers.
 */
function playbackLoop(): void {
  const store = getSequencerStore();
  if (!store.isPlaying || store.isExternalPlayback) return;

  const now = performance.now();
  const elapsed = now - lastFrameTime;
  const msPerTick = 60000 / (store.bpm * TICKS_PER_QUARTER);
  tickAccumulator += elapsed;

  const ticksToProcess = Math.floor(tickAccumulator / msPerTick);
  if (ticksToProcess > 0) {
    for (let i = 0; i < ticksToProcess; i++) {
      tick();
    }
    tickAccumulator -= ticksToProcess * msPerTick;
  }

  lastFrameTime = now;
  playbackTimerId = setTimeout(playbackLoop, 1);
}

/**
 * Start internal playback
 */
export function play(): void {
  const store = getSequencerStore();
  if (playbackTimerId) return;

  store._setIsPlaying(true);
  store._setIsExternalPlayback(false);

  invalidateAll();
  computePreviewAll();

  lastFrameTime = performance.now();
  tickAccumulator = 0;

  tick();
  playbackTimerId = setTimeout(playbackLoop, 1);
}

/**
 * Stop playback and reset
 */
export function stop(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
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
  store._setCurrentTick(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}

function pause(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  getSequencerStore()._setIsPlaying(false);
}

export function resetPlayhead(): void {
  getSequencerStore()._setCurrentTick(-1);
}

export function setBpm(bpm: number): void {
  getSequencerStore()._setBpm(bpm);
  // Playback loop auto-adjusts via msPerTick calculation each iteration
}

export function togglePlay(): void {
  const store = getSequencerStore();
  if (store.isPlaying) {
    pause();
  } else {
    play();
  }
}

// ============ External MIDI Sync ============

const TICKS_PER_MIDI_CLOCK = TICKS_PER_QUARTER / 24; // 20 ticks per MIDI clock pulse

export function playExternal(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  const store = getSequencerStore();
  store._setIsPlaying(true);
  store._setIsExternalPlayback(true);

  invalidateAll();
  computePreviewAll();
}

export function externalTick(): void {
  const store = getSequencerStore();
  if (!store.isPlaying) return;
  for (let i = 0; i < TICKS_PER_MIDI_CLOCK; i++) {
    tick();
  }
}

export function stopExternal(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
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
  store._setCurrentTick(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
