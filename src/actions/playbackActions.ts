import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { getLookup, invalidateAll, setWasmSyncEngine } from '../store/tickLookupCache';
import {
  type NoteEvent,
  type ModifySubMode,
  getEventSubModeLoopMode,
  getEventSubModeValueAtRepeat,
  getEventSubModeValueAtRepeatFill,
  TICKS_PER_QUARTER,
} from '../types/event';
import { SCALES, buildScaleMapping, noteToMidi, type ScaleMapping } from '../types/scales';
import { getChordOffsets } from '../types/chords';
import type { WasmEngine } from '../engine/WasmEngine';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number; // Fixed micro-timing offset as % of step (signed)
  flamCount?: number;            // Number of flam grace notes (0 = none)
}

// Callback references
let stepTriggerCallback: ((channel: number, row: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;
let noteOffCallback: ((channel: number, midiNote: number) => void) | null = null;

// WASM engine reference (set from App.tsx when engine loads)
let wasmEngine: WasmEngine | null = null;

export function setWasmEngine(engine: WasmEngine | null): void {
  wasmEngine = engine;
  setWasmSyncEngine(engine);
  if (engine) {
    // Wire WASM preview callback into the TS preview map
    engine.onPreviewValue = (subMode, ch, eventIndex, tick, value) => {
      // Convert eventIndex back to UUID for the preview map key
      const store = getSequencerStore();
      const patIdx = store.currentPatterns[ch];
      const eventId = engine.getEventId(ch, patIdx, eventIndex);
      if (eventId) {
        subModePreview.set(`${subMode}:${ch}:${eventId}:${tick}`, value);
      }
    };
  }
}

/** Check if WASM engine is loaded and ready */
function wasmReady(): boolean {
  return wasmEngine !== null && wasmEngine.isReady();
}

// Playback loop state
let playbackTimerId: ReturnType<typeof setTimeout> | null = null;
let lastFrameTime: number = 0;
let tickAccumulator: number = 0;

/**
 * Get the current cumulative counter for an event's sub-mode from the WASM engine.
 */
export function getContinueCounter(subMode: ModifySubMode, channel: number, eventId: string): number {
  if (!wasmEngine?.isReady()) return 0;
  return wasmEngine.getContinueCounter(subMode, channel, eventId);
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

/**
 * Register an active note from the WASM engine.
 * Called by WasmEngine's stepTrigger callback so the grid can highlight playing notes.
 */
export function registerWasmActiveNote(
  ch: number, eventId: string, tick: number, length: number, midiNote: number
): void {
  const key = `${ch}:${eventId}:wasm`;
  const existing = activeNotes.get(key);
  if (existing) {
    existing.start = tick;
    existing.end = tick + length - 1;
    existing.midiNote = midiNote;
  } else {
    activeNotes.set(key, { start: tick, end: tick + length - 1, midiNote });
  }
}

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
    // For scrub/audition, use the WASM counter if available, else fall back to repeat index
    const count = getContinueCounter(subMode, channel, event.id);
    return getEventSubModeValueAtRepeat(event, subMode, count > 0 ? count : repeatIndex);
  } else if (loopMode === "fill") {
    return getEventSubModeValueAtRepeatFill(event, subMode, repeatIndex);
  } else {
    return getEventSubModeValueAtRepeat(event, subMode, repeatIndex);
  }
}

/**
 * Get the current scale mapping from the store.
 */
function getCurrentScaleMapping(): ScaleMapping {
  const store = getSequencerStore();
  const pattern = SCALES[store.scaleId]?.pattern ?? SCALES.major.pattern;
  return buildScaleMapping(store.scaleRoot, pattern);
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
 * Advance the sequencer by one tick (delegates to WASM engine)
 */
export function tick(): void {
  if (!wasmReady()) return;
  wasmEngine!.tick();
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
  subModePreview.clear();

  if (wasmReady()) {
    wasmEngine!.syncAll(store);
    wasmEngine!.init();
  }

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
  if (wasmReady()) {
    wasmEngine!.stop();
  }
  activeNotes.clear();
  subModePreview.clear();
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

// Track previous scrub tick to trigger all notes in the scrubbed range
let lastScrubTick = -1;

/**
 * Scrub the playhead to a specific tick position and trigger all notes
 * between the previous scrub position and the new one.
 * Used for shift-drag scrubbing on the horizontal strip.
 */
export function scrubToTick(targetTick: number): void {
  const store = getSequencerStore();
  const { currentPatterns, patternLoops, mutedChannels, soloedChannels } = store;
  const mapping = getCurrentScaleMapping();

  // Set the tick directly
  store._setCurrentTick(targetTick);

  // Trigger notes for audio feedback
  if (!stepTriggerCallback) return;

  const anySoloed = soloedChannels.some((s) => s);

  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    const patternIdx = currentPatterns[ch];
    const loop = patternLoops[ch][patternIdx];
    const loopEnd = loop.start + loop.length;

    // Check mute/solo
    const shouldPlay = anySoloed
      ? soloedChannels[ch] && !mutedChannels[ch]
      : !mutedChannels[ch];
    if (!shouldPlay) continue;

    const lookup = getLookup(ch, patternIdx);

    // Determine the tick range to scan for notes
    const prevTick = lastScrubTick;
    const currLooped =
      loop.start +
      ((((targetTick - loop.start) % loop.length) + loop.length) % loop.length);

    let scanStart: number;
    let scanEnd: number;

    if (prevTick < 0) {
      // First scrub — just trigger at the current tick
      scanStart = currLooped;
      scanEnd = currLooped;
    } else {
      const prevLooped =
        loop.start +
        ((((prevTick - loop.start) % loop.length) + loop.length) % loop.length);

      if (targetTick >= prevTick) {
        // Scrubbing forward
        scanStart = prevLooped + 1;
        scanEnd = currLooped;
      } else {
        // Scrubbing backward
        scanStart = currLooped;
        scanEnd = prevLooped - 1;
      }
    }

    if (scanStart > scanEnd) {
      // Swap for backward scrubbing — we still want to trigger all notes in range
      const tmp = scanStart;
      scanStart = scanEnd;
      scanEnd = tmp;
    }

    // Clamp to loop range
    scanStart = Math.max(loop.start, scanStart);
    scanEnd = Math.min(loopEnd - 1, scanEnd);

    // Scan all ticks in range and trigger notes found in the lookup
    for (const [tick, entries] of lookup) {
      if (tick < scanStart || tick > scanEnd) continue;

      for (const { event, repeatIndex } of entries) {
        const velocity = resolveSubModeValue(event, "velocity", repeatIndex, ch);
        const modulateVal = resolveSubModeValue(event, "modulate", repeatIndex, ch);
        const effectiveRow = event.row + modulateVal;

        // Expand chord offsets
        const chordOffsets = getChordOffsets(event.chordStackSize, event.chordShapeIndex, event.chordInversion);

        for (let ci = 0; ci < chordOffsets.length; ci++) {
          const chordRow = effectiveRow + chordOffsets[ci];
          const midiNote = store.channelTypes[ch] === "drum"
            ? Math.max(0, Math.min(127, chordRow))
            : noteToMidi(chordRow, mapping);
          if (midiNote < 0) continue; // Out of MIDI range

          // Send note-off for any currently active note on this event
          const activeKey = `${ch}:${event.id}:${repeatIndex}:${ci}`;
          const existing = activeNotes.get(activeKey);
          if (existing && noteOffCallback) noteOffCallback(ch, existing.midiNote);
          activeNotes.set(activeKey, { start: tick, end: tick + event.length - 1, midiNote });

          stepTriggerCallback(ch, midiNote, tick, event.length, velocity);
        }
      }
    }
  }

  lastScrubTick = targetTick;
}

/**
 * Reset scrub state (call when scrub ends).
 */
export function scrubEnd(): void {
  lastScrubTick = -1;
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
  subModePreview.clear();

  if (wasmReady()) {
    wasmEngine!.syncAll(store);
    wasmEngine!.init();
  }
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
  if (wasmReady()) {
    wasmEngine!.stop();
  }
  activeNotes.clear();
  subModePreview.clear();
  const store = getSequencerStore();
  store._setIsPlaying(false);
  store._setIsExternalPlayback(false);
  store._setCurrentTick(-1);
  store._setQueuedPatterns(Array(NUM_CHANNELS).fill(null));
}
