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
