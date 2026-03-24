import { getEngine } from './playbackActions';
import { markDirty } from '../store/renderStore';

/**
 * Clear current pattern.
 * Delegates to engine which owns pattern data and loops.
 */
export function clearPattern(): void {
  const engine = getEngine();
  if (!engine?.isReady()) return;

  engine.clearPattern();
  markDirty();
}
