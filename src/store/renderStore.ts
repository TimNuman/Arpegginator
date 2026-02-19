import { useSyncExternalStore } from 'react';

// ============ Render Trigger ============
// Simple external store that triggers React re-renders when WASM state changes.
// No state mirroring — React reads directly from WASM on each render.

let renderVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return renderVersion;
}

/** Trigger a React re-render. Call after any WASM state change. */
export function markDirty(): void {
  renderVersion++;
  for (const listener of listeners) {
    listener();
  }
}

/** React hook — subscribes to render version changes. */
export function useRenderVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ============ Transport State ============
// JS owns the playback timer, so it needs these values outside of WASM.

let _isPlaying = false;
let _isExternalPlayback = false;
let _bpm = 120;

export function getIsPlaying(): boolean { return _isPlaying; }
export function getIsExternalPlayback(): boolean { return _isExternalPlayback; }
export function getBpm(): number { return _bpm; }

export function setIsPlaying(playing: boolean): void {
  _isPlaying = playing;
  markDirty();
}

export function setIsExternalPlayback(external: boolean): void {
  _isExternalPlayback = external;
  markDirty();
}

export function setBpm(bpm: number): void {
  _bpm = bpm;
  markDirty();
}
