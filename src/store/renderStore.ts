import { useSyncExternalStore } from 'react';

// ============ Render Loop ============
// Fixed-framerate render loop. Event handlers call markDirty() to flag that
// WASM state changed — the loop coalesces all changes into one React re-render
// per animation frame. The loop also keeps running while WASM reports animation
// (inertia, camera easing, playback follow).

let renderVersion = 0;
const listeners = new Set<() => void>();
let dirty = false;
let loopRunning = false;
let checkAnimating: (() => boolean) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return renderVersion;
}

function flush(): void {
  renderVersion++;
  for (const listener of listeners) {
    listener();
  }
}

function loop(): void {
  const anim = checkAnimating ? checkAnimating() : false;
  if (dirty || anim) {
    dirty = false;
    flush();
    requestAnimationFrame(loop);
  } else {
    loopRunning = false;
  }
}

function ensureLoop(): void {
  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame(loop);
  }
}

/**
 * Flag that WASM state changed. Cheap — just sets a flag and ensures
 * the render loop is running. React re-render happens on next frame.
 */
export function markDirty(): void {
  dirty = true;
  ensureLoop();
}

/**
 * Register the isAnimating check so the loop keeps running during
 * inertia / camera easing / playback. Call once on mount.
 */
export function setAnimatingCheck(fn: () => boolean): void {
  checkAnimating = fn;
}

/** React hook — subscribes to render version changes. */
export function useRenderVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
