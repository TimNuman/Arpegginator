import { TICKS_PER_QUARTER } from '../components/Grid/Grid.config';
import type { Engine } from '../engine/types';
import { markDirty } from '../store/renderStore';

// Extra parameters passed alongside each triggered note
export interface StepTriggerExtras {
  timingOffsetPercent?: number;
  flamCount?: number;
}

// Engine reference (set from App.tsx when engine loads)
let engine: Engine | null = null;

export function setEngine(e: Engine | null): void {
  engine = e;
}

/** Return the engine if it's loaded and ready, otherwise null. */
function readyEngine(): Engine | null {
  return engine?.isReady() ? engine : null;
}

export function getEngine(): Engine | null {
  return engine;
}

// JS timer state (only thing JS must own)
let playbackTimerId: ReturnType<typeof setTimeout> | null = null;
let lastFrameTime: number = 0;
let tickAccumulator: number = 0;

// ============ Playback Loop ============

function playbackLoop(): void {
  if (!engine || !engine.getIsPlaying() || engine.getIsExternalPlayback()) return;

  const now = performance.now();
  const elapsed = now - lastFrameTime;
  const msPerTick = 60000 / (engine.getBpm() * TICKS_PER_QUARTER);
  tickAccumulator += elapsed;

  const ticksToProcess = Math.floor(tickAccumulator / msPerTick);
  if (ticksToProcess > 0) {
    for (let i = 0; i < ticksToProcess; i++) {
      engine.tick();
    }
    tickAccumulator -= ticksToProcess * msPerTick;
  }

  lastFrameTime = now;
  playbackTimerId = setTimeout(playbackLoop, 1);
}

// ============ Public API ============

export function play(): void {
  const e = readyEngine();
  if (!e || playbackTimerId) return;

  e.setIsPlaying(true);
  e.setIsExternalPlayback(false);
  e.seedRng();

  const resumeTick = e.getResumeTick();
  if (resumeTick >= 0) {
    e.initFromTick(resumeTick);
    e.setResumeTick(-1);
  } else {
    e.init();
  }

  // Both WASM and Teensy run the local tick loop for grid rendering.
  // Teensy drives actual MIDI output; local engine just mirrors for display.
  lastFrameTime = performance.now();
  tickAccumulator = 0;
  e.tick();
  markDirty();
  playbackTimerId = setTimeout(playbackLoop, 1);
}

export function stop(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  const e = readyEngine();
  if (e) {
    const t = e.getCurrentTick();
    if (t >= 0) e.setResumeTick(t);
    e.stop();
    e.setIsPlaying(false);
    e.setIsExternalPlayback(false);
  }
  markDirty();
}

export function resetPosition(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  const e = readyEngine();
  if (e) {
    e.stop();
    e.init();
    e.setIsPlaying(false);
    e.setIsExternalPlayback(false);
    e.setResumeTick(-1);
  }
  markDirty();
}

export function setBpm(bpm: number): void {
  readyEngine()?.setBpm(bpm);
  markDirty();
}

export function setSwing(swing: number): void {
  readyEngine()?.setSwing(swing);
  markDirty();
}

export function togglePlay(): void {
  if (readyEngine()?.getIsPlaying()) {
    stop();
  } else {
    play();
  }
}

// ============ External MIDI Sync ============

const TICKS_PER_MIDI_CLOCK = TICKS_PER_QUARTER / 24;

export function playExternal(): void {
  const e = readyEngine();
  if (!e) return;
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  e.setIsPlaying(true);
  e.setIsExternalPlayback(true);
  e.seedRng();
  e.init();
  markDirty();
}

export function externalTick(): void {
  const e = readyEngine();
  if (!e || !e.getIsPlaying()) return;
  for (let i = 0; i < TICKS_PER_MIDI_CLOCK; i++) {
    e.tick();
  }
}

export function stopExternal(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  const e = readyEngine();
  if (e) {
    e.stop();
    e.setIsPlaying(false);
    e.setIsExternalPlayback(false);
  }
  markDirty();
}
