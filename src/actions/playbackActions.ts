import { TICKS_PER_QUARTER } from '../types/event';
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

// WASM engine reference (set from App.tsx when engine loads)
let wasmEngine: WasmEngine | null = null;

export function setWasmEngine(engine: WasmEngine | null): void {
  wasmEngine = engine;
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

// Remembered position from scrub (for resume on play)
let resumeTick: number = -1;

// ============ Public API ============

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

  if (wasmReady()) {
    wasmEngine!.setIsPlaying(true);
    wasmEngine!.seedRng();
    if (resumeTick >= 0) {
      wasmEngine!.initFromTick(resumeTick);
      resumeTick = -1;
    } else {
      wasmEngine!.init();
    }
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
  // Remember current position for resume
  if (wasmReady()) {
    const t = wasmEngine!.getCurrentTick();
    if (t >= 0) resumeTick = t;
    wasmEngine!.stop();
    wasmEngine!.setIsPlaying(false);
  }
  setIsPlaying(false);
  setIsExternalPlayback(false);
  markDirty();
}

/** Stop and reset position to beginning. */
export function resetPosition(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  resumeTick = -1;
  if (wasmReady()) {
    wasmEngine!.stop();
    wasmEngine!.init();  // Reset tick to -1 (beginning)
    wasmEngine!.setIsPlaying(false);
  }
  setIsPlaying(false);
  setIsExternalPlayback(false);
  markDirty();
}

export function scrubToTick(targetTick: number): void {
  if (!wasmReady()) return;
  wasmEngine!.scrubToTick(targetTick);
  markDirty();
}

export function scrubEnd(): void {
  if (!wasmReady()) return;
  // Remember scrub position for resume on play
  const t = wasmEngine!.getCurrentTick();
  if (t >= 0) resumeTick = t;
  wasmEngine!.scrubEnd();
}

export function setBpm(bpm: number): void {
  setRenderBpm(bpm);
  if (wasmReady()) {
    wasmEngine!.setBpm(bpm);
  }
}

export function togglePlay(): void {
  if (getIsPlaying()) {
    stop();
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
  setIsPlaying(false);
  setIsExternalPlayback(false);
  markDirty();
}
