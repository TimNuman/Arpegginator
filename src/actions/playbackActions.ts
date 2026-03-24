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

function engineReady(): boolean {
  return engine !== null && engine.isReady();
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
  if (!engineReady() || playbackTimerId) return;

  engine!.setIsPlaying(true);
  engine!.setIsExternalPlayback(false);
  engine!.seedRng();

  const resumeTick = engine!.getResumeTick();
  if (resumeTick >= 0) {
    engine!.initFromTick(resumeTick);
    engine!.setResumeTick(-1);
  } else {
    engine!.init();
  }

  if (engine!.isTeensy) {
    // Teensy drives ticks via PIT timer — no JS tick loop needed
    markDirty();
  } else {
    lastFrameTime = performance.now();
    tickAccumulator = 0;
    engine!.tick();
    markDirty();
    playbackTimerId = setTimeout(playbackLoop, 1);
  }
}

export function stop(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (engineReady()) {
    const t = engine!.getCurrentTick();
    if (t >= 0) engine!.setResumeTick(t);
    engine!.stop();
    engine!.setIsPlaying(false);
    engine!.setIsExternalPlayback(false);
  }
  markDirty();
}

export function resetPosition(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (engineReady()) {
    engine!.stop();
    engine!.init();
    engine!.setIsPlaying(false);
    engine!.setIsExternalPlayback(false);
    engine!.setResumeTick(-1);
  }
  markDirty();
}

export function setBpm(bpm: number): void {
  if (engineReady()) {
    engine!.setBpm(bpm);
  }
  markDirty();
}

export function setSwing(swing: number): void {
  if (engineReady()) {
    engine!.setSwing(swing);
  }
  markDirty();
}

export function togglePlay(): void {
  if (engineReady() && engine!.getIsPlaying()) {
    stop();
  } else {
    play();
  }
}

// ============ External MIDI Sync ============

const TICKS_PER_MIDI_CLOCK = TICKS_PER_QUARTER / 24;

export function playExternal(): void {
  if (!engineReady()) return;
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  engine!.setIsPlaying(true);
  engine!.setIsExternalPlayback(true);
  engine!.seedRng();
  engine!.init();
  markDirty();
}

export function externalTick(): void {
  if (!engineReady() || !engine!.getIsPlaying()) return;
  for (let i = 0; i < TICKS_PER_MIDI_CLOCK; i++) {
    engine!.tick();
  }
}

export function stopExternal(): void {
  if (playbackTimerId) {
    clearTimeout(playbackTimerId);
    playbackTimerId = null;
  }
  if (engineReady()) {
    engine!.stop();
    engine!.setIsPlaying(false);
    engine!.setIsExternalPlayback(false);
  }
  markDirty();
}
