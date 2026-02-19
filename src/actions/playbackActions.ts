import { NUM_CHANNELS } from '../store/sequencerStore';
import { getLookup, invalidateAll, setWasmSyncEngine } from '../store/tickLookupCache';
import {
  type NoteEvent,
  type ModifySubMode,
  getEventSubModeLoopMode,
  getEventSubModeValueAtRepeat,
  getEventSubModeValueAtRepeatFill,
  TICKS_PER_QUARTER,
} from '../types/event';
import { SCALES, SCALE_ORDER, buildScaleMapping, noteToMidi, type ScaleMapping } from '../types/scales';
import { getChordOffsets } from '../types/chords';
import type { WasmEngine } from '../engine/WasmEngine';
import {
  getIsPlaying, getIsExternalPlayback, getBpm,
  setIsPlaying, setIsExternalPlayback, setBpm as setRenderBpm,
  markDirty,
} from '../store/renderStore';

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
      const patIdx = engine.getCurrentPattern(ch);
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

/** Get the WASM engine instance (null if not loaded). */
export function getWasmEngine(): WasmEngine | null {
  return wasmEngine;
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
const subModePreview = new Map<string, number>();

export function getSubModePreview(subMode: ModifySubMode, ch: number, eventId: string, tick: number): number | undefined {
  return subModePreview.get(`${subMode}:${ch}:${eventId}:${tick}`);
}

export function getHitChancePreview(ch: number, eventId: string, tick: number): number | undefined {
  return getSubModePreview("hit", ch, eventId, tick);
}

function resolveSubModeValue(
  event: NoteEvent,
  subMode: ModifySubMode,
  repeatIndex: number,
  channel: number,
): number {
  const loopMode = getEventSubModeLoopMode(event, subMode);
  if (loopMode === "continue") {
    const count = getContinueCounter(subMode, channel, event.id);
    return getEventSubModeValueAtRepeat(event, subMode, count > 0 ? count : repeatIndex);
  } else if (loopMode === "fill") {
    return getEventSubModeValueAtRepeatFill(event, subMode, repeatIndex);
  } else {
    return getEventSubModeValueAtRepeat(event, subMode, repeatIndex);
  }
}

function getCurrentScaleMapping(): ScaleMapping {
  if (!wasmReady()) {
    return buildScaleMapping(0, SCALES.major.pattern);
  }
  const scaleRoot = wasmEngine!.getScaleRoot();
  const scaleIdIdx = wasmEngine!.getScaleIdIdx();
  const scaleId = SCALE_ORDER[scaleIdIdx] ?? "major";
  const pattern = SCALES[scaleId]?.pattern ?? SCALES.major.pattern;
  return buildScaleMapping(scaleRoot, pattern);
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

export function tick(): void {
  if (!wasmReady()) return;
  wasmEngine!.tick();
}

function playbackLoop(): void {
  if (!getIsPlaying() || getIsExternalPlayback()) return;

  const now = performance.now();
  const elapsed = now - lastFrameTime;
  const msPerTick = 60000 / (getBpm() * TICKS_PER_QUARTER);
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

export function play(): void {
  if (playbackTimerId) return;

  setIsPlaying(true);
  setIsExternalPlayback(false);

  invalidateAll();
  subModePreview.clear();

  if (wasmReady()) {
    wasmEngine!.setIsPlaying(true);
    wasmEngine!.seedRng();
    wasmEngine!.init();
  }

  lastFrameTime = performance.now();
  tickAccumulator = 0;

  tick();
  playbackTimerId = setTimeout(playbackLoop, 1);
}

export function stop(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (wasmReady()) {
    wasmEngine!.stop();
    wasmEngine!.setIsPlaying(false);
  }
  activeNotes.clear();
  subModePreview.clear();
  setIsPlaying(false);
  setIsExternalPlayback(false);
  markDirty();
}

function pause(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  setIsPlaying(false);
  if (wasmReady()) {
    wasmEngine!.setIsPlaying(false);
  }
}

export function resetPlayhead(): void {
  markDirty();
}

let lastScrubTick = -1;

export function scrubToTick(targetTick: number): void {
  if (!wasmReady()) return;

  const mapping = getCurrentScaleMapping();
  const { muted: mutedChannels, soloed: soloedChannels } = wasmEngine!.readMuteSolo();

  markDirty();

  if (!stepTriggerCallback) return;

  const anySoloed = soloedChannels.some((s) => s);

  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    const patternIdx = wasmEngine!.getCurrentPattern(ch);
    const loop = wasmEngine!.readLoop(ch, patternIdx);
    const loopEnd = loop.start + loop.length;

    const shouldPlay = anySoloed
      ? soloedChannels[ch] && !mutedChannels[ch]
      : !mutedChannels[ch];
    if (!shouldPlay) continue;

    const lookup = getLookup(ch, patternIdx);

    const prevTick = lastScrubTick;
    const currLooped =
      loop.start +
      ((((targetTick - loop.start) % loop.length) + loop.length) % loop.length);

    let scanStart: number;
    let scanEnd: number;

    if (prevTick < 0) {
      scanStart = currLooped;
      scanEnd = currLooped;
    } else {
      const prevLooped =
        loop.start +
        ((((prevTick - loop.start) % loop.length) + loop.length) % loop.length);

      if (targetTick >= prevTick) {
        scanStart = prevLooped + 1;
        scanEnd = currLooped;
      } else {
        scanStart = currLooped;
        scanEnd = prevLooped - 1;
      }
    }

    if (scanStart > scanEnd) {
      const tmp = scanStart;
      scanStart = scanEnd;
      scanEnd = tmp;
    }

    scanStart = Math.max(loop.start, scanStart);
    scanEnd = Math.min(loopEnd - 1, scanEnd);

    const channelType = wasmEngine!.getChannelType(ch);

    for (const [t, entries] of lookup) {
      if (t < scanStart || t > scanEnd) continue;

      for (const { event, repeatIndex } of entries) {
        const velocity = resolveSubModeValue(event, "velocity", repeatIndex, ch);
        const modulateVal = resolveSubModeValue(event, "modulate", repeatIndex, ch);
        const effectiveRow = event.row + modulateVal;

        const chordOffsets = getChordOffsets(event.chordStackSize, event.chordShapeIndex, event.chordInversion);

        for (let ci = 0; ci < chordOffsets.length; ci++) {
          const chordRow = effectiveRow + chordOffsets[ci];
          const midiNote = channelType === 1
            ? Math.max(0, Math.min(127, chordRow))
            : noteToMidi(chordRow, mapping);
          if (midiNote < 0) continue;

          const activeKey = `${ch}:${event.id}:${repeatIndex}:${ci}`;
          const existing = activeNotes.get(activeKey);
          if (existing && noteOffCallback) noteOffCallback(ch, existing.midiNote);
          activeNotes.set(activeKey, { start: t, end: t + event.length - 1, midiNote });

          stepTriggerCallback(ch, midiNote, t, event.length, velocity);
        }
      }
    }
  }

  lastScrubTick = targetTick;
}

export function scrubEnd(): void {
  lastScrubTick = -1;
}

export function setBpm(bpm: number): void {
  setRenderBpm(bpm);
  if (wasmReady()) {
    wasmEngine!.setBpm(bpm);
  }
}

export function togglePlay(): void {
  if (getIsPlaying()) {
    pause();
  } else {
    play();
  }
}

// ============ External MIDI Sync ============

const TICKS_PER_MIDI_CLOCK = TICKS_PER_QUARTER / 24;

export function playExternal(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  setIsPlaying(true);
  setIsExternalPlayback(true);

  invalidateAll();
  subModePreview.clear();

  if (wasmReady()) {
    wasmEngine!.setIsPlaying(true);
    wasmEngine!.seedRng();
    wasmEngine!.init();
  }
}

export function externalTick(): void {
  if (!getIsPlaying()) return;
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
    wasmEngine!.setIsPlaying(false);
  }
  activeNotes.clear();
  subModePreview.clear();
  setIsPlaying(false);
  setIsExternalPlayback(false);
  markDirty();
}
