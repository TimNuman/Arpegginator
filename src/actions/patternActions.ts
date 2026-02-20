import { getWasmEngine } from './playbackActions';
import { markDirty } from '../store/renderStore';

/**
 * Clear current pattern.
 * Delegates to WASM which owns pattern data and loops.
 */
export function clearPattern(): void {
  const wasmEngine = getWasmEngine();
  if (!wasmEngine?.isReady()) return;

  wasmEngine.clearPattern();
  markDirty();
}
