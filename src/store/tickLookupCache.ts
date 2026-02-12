// ============ Tick Lookup Cache ============
// Module-level cache for TickLookupMaps, keyed by "ch:pat".
// Rebuilt lazily when accessed after invalidation.

import { buildTickLookup, type TickLookupMap } from "../types/event";
import { getSequencerStore } from "./sequencerStore";

const cache = new Map<string, TickLookupMap>();

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
}

/**
 * Invalidate all cached lookups.
 * Called on play start or major state changes.
 */
export function invalidateAll(): void {
  cache.clear();
}
