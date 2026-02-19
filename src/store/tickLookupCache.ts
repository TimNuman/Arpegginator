// ============ Tick Lookup Cache ============
// Module-level cache for TickLookupMaps, keyed by "ch:pat".
// Rebuilt lazily when accessed after invalidation.

import { buildTickLookup, type TickLookupMap } from "../types/event";
import { getSequencerStore } from "./sequencerStore";
import type { WasmEngine } from "../engine/WasmEngine";

const cache = new Map<string, TickLookupMap>();

// WASM engine sync hook: when set, pattern invalidations also sync to WASM
let wasmSyncEngine: WasmEngine | null = null;

export function setWasmSyncEngine(engine: WasmEngine | null): void {
  wasmSyncEngine = engine;
}

function cacheKey(channel: number, pattern: number): string {
  return `${channel}:${pattern}`;
}

/**
 * Get or build the lookup map for a given channel/pattern.
 * Returns the cached map if available, otherwise builds and caches it.
 */
export function getLookup(channel: number, pattern: number): TickLookupMap {
  const key = cacheKey(channel, pattern);
  const cached = cache.get(key);
  if (cached) return cached;

  const store = getSequencerStore();
  const patternData = store.patterns[channel]?.[pattern];
  if (!patternData) {
    const empty: TickLookupMap = new Map();
    cache.set(key, empty);
    return empty;
  }

  const lookup = buildTickLookup(patternData.events, patternData.lengthTicks);
  cache.set(key, lookup);
  return lookup;
}

/**
 * Invalidate the cache for a specific channel/pattern.
 * Called whenever a pattern's events are modified.
 */
export function invalidateLookup(channel: number, pattern: number): void {
  cache.delete(cacheKey(channel, pattern));

  // Live sync to WASM engine if it's active and playing
  if (wasmSyncEngine?.isReady()) {
    const store = getSequencerStore();
    if (store.isPlaying) {
      const patternData = store.patterns[channel]?.[pattern];
      if (patternData) {
        wasmSyncEngine.syncPattern(channel, pattern, patternData);
      }
    }
  }
}

/**
 * Invalidate all cached lookups.
 * Called on play start or major state changes.
 */
export function invalidateAll(): void {
  cache.clear();
}

// ============ Live WASM Sync Helpers ============
// These are called from action modules when state changes during WASM playback.

function isWasmPlaying(): boolean {
  if (!wasmSyncEngine?.isReady()) return false;
  return getSequencerStore().isPlaying;
}

/** Sync mute/solo state to WASM during live playback. */
export function syncWasmMuteSolo(): void {
  if (!isWasmPlaying()) return;
  wasmSyncEngine!.syncMuteSolo(getSequencerStore());
}

/** Sync loop boundaries to WASM during live playback. */
export function syncWasmLoops(): void {
  if (!isWasmPlaying()) return;
  wasmSyncEngine!.syncLoops(getSequencerStore());
}

/** Sync queued patterns to WASM during live playback. */
export function syncWasmQueuedPatterns(): void {
  if (!isWasmPlaying()) return;
  wasmSyncEngine!.syncQueuedPatterns(getSequencerStore());
}

/** Sync current patterns to WASM during live playback. */
export function syncWasmCurrentPatterns(): void {
  if (!isWasmPlaying()) return;
  wasmSyncEngine!.syncCurrentPatterns(getSequencerStore());
}

/** Sync scale to WASM during live playback. */
export function syncWasmScale(): void {
  if (!isWasmPlaying()) return;
  wasmSyncEngine!.syncScale(getSequencerStore());
}
