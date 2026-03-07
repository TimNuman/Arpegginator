import { TICKS_PER_QUARTER } from '../components/Grid/Grid.config';
import type { WasmEngine } from '../engine/WasmEngine';
import { markDirty } from '../store/renderStore';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number;
  flamCount?: number;
}

// WASM engine reference (set from App.tsx when engine loads)
let wasmEngine: WasmEngine | null = null;

export function setWasmEngine(engine: WasmEngine | null): void {
  wasmEngine = engine;
}

function wasmReady(): boolean {
  return wasmEngine !== null && wasmEngine.isReady();
}

export function getWasmEngine(): WasmEngine | null {
  return wasmEngine;
}

// JS timer state (only thing JS must own)
let playbackTimerId: ReturnType<typeof setTimeout> | null = null;
let lastFrameTime: number = 0;
let tickAccumulator: number = 0;

// ============ Playback Loop ============

function playbackLoop(): void {
  if (!wasmEngine || !wasmEngine.getIsPlaying() || wasmEngine.getIsExternalPlayback()) return;

  const now = performance.now();
  const elapsed = now - lastFrameTime;
  const msPerTick = 60000 / (wasmEngine.getBpm() * TICKS_PER_QUARTER);
  tickAccumulator += elapsed;

  const ticksToProcess = Math.floor(tickAccumulator / msPerTick);
  if (ticksToProcess > 0) {
    for (let i = 0; i < ticksToProcess; i++) {
      wasmEngine.tick();
    }
    tickAccumulator -= ticksToProcess * msPerTick;
  }

  lastFrameTime = now;
  playbackTimerId = setTimeout(playbackLoop, 1);
}

// ============ Public API ============

export function play(): void {
  if (!wasmReady() || playbackTimerId) return;

  wasmEngine!.setIsPlaying(true);
  wasmEngine!.setIsExternalPlayback(false);
  wasmEngine!.seedRng();

  const resumeTick = wasmEngine!.getResumeTick();
  if (resumeTick >= 0) {
    wasmEngine!.initFromTick(resumeTick);
    wasmEngine!.setResumeTick(-1);
  } else {
    wasmEngine!.init();
  }

  lastFrameTime = performance.now();
  tickAccumulator = 0;

  wasmEngine!.tick();
  markDirty();
  playbackTimerId = setTimeout(playbackLoop, 1);
}

export function stop(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (wasmReady()) {
    const t = wasmEngine!.getCurrentTick();
    if (t >= 0) wasmEngine!.setResumeTick(t);
    wasmEngine!.stop();
    wasmEngine!.setIsPlaying(false);
    wasmEngine!.setIsExternalPlayback(false);
  }
  markDirty();
}

export function resetPosition(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (wasmReady()) {
    wasmEngine!.stop();
    wasmEngine!.init();
    wasmEngine!.setIsPlaying(false);
    wasmEngine!.setIsExternalPlayback(false);
    wasmEngine!.setResumeTick(-1);
  }
  markDirty();
}

export function setBpm(bpm: number): void {
  if (wasmReady()) {
    wasmEngine!.setBpm(bpm);
  }
  markDirty();
}

export function togglePlay(): void {
  if (wasmReady() && wasmEngine!.getIsPlaying()) {
    stop();
  } else {
    play();
  }
}

// ============ External MIDI Sync ============

const TICKS_PER_MIDI_CLOCK = TICKS_PER_QUARTER / 24;

export function playExternal(): void {
  if (!wasmReady()) return;
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  wasmEngine!.setIsPlaying(true);
  wasmEngine!.setIsExternalPlayback(true);
  wasmEngine!.seedRng();
  wasmEngine!.init();
  markDirty();
}

export function externalTick(): void {
  if (!wasmReady() || !wasmEngine!.getIsPlaying()) return;
  for (let i = 0; i < TICKS_PER_MIDI_CLOCK; i++) {
    wasmEngine!.tick();
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
    wasmEngine!.setIsExternalPlayback(false);
  }
  markDirty();
}
