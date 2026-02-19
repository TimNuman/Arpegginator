// ============ Tick Lookup Cache ============
// Module-level cache for TickLookupMaps, keyed by "ch:pat".
// Used only for scrub-to-tick audio feedback.

import { buildTickLookup, type TickLookupMap } from "../types/event";
import type { WasmEngine } from "../engine/WasmEngine";

const cache = new Map<string, TickLookupMap>();

// WASM engine reference for reading pattern data
let wasmSyncEngine: WasmEngine | null = null;

export function setWasmSyncEngine(engine: WasmEngine | null): void {
  wasmSyncEngine = engine;
}

function cacheKey(channel: number, pattern: number): string {
  return `${channel}:${pattern}`;
}

/**
 * Get or build the lookup map for a given channel/pattern.
 * Reads pattern data from WASM (source of truth).
 */
export function getLookup(channel: number, pattern: number): TickLookupMap {
  const key = cacheKey(channel, pattern);
  const cached = cache.get(key);
  if (cached) return cached;

  // Read pattern data from WASM
  if (!wasmSyncEngine?.isReady()) {
    const empty: TickLookupMap = new Map();
    cache.set(key, empty);
    return empty;
  }

  const patternData = wasmSyncEngine.readPatternData(channel, pattern);
  if (!patternData || patternData.events.length === 0) {
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
 */
export function invalidateLookup(channel: number, pattern: number): void {
  cache.delete(cacheKey(channel, pattern));
}

/**
 * Invalidate all cached lookups.
 */
export function invalidateAll(): void {
  cache.clear();
}
