import { getWasmEngine } from './playbackActions';

/**
 * Toggle mute for a channel.
 * A channel can't be muted and soloed at the same time — muting unsolos.
 * WASM owns mute/solo state; we read-modify-write directly in WASM memory.
 */
export function toggleMute(channel: number): void {
  const engine = getWasmEngine();
  if (!engine?.isReady()) return;

  const { muted, soloed } = engine.readMuteSolo();
  muted[channel] = !muted[channel];
  // Muting a soloed channel unsolos it
  if (muted[channel] && soloed[channel]) {
    soloed[channel] = false;
  }
  engine.writeMuteSolo(muted, soloed);
}

/**
 * Toggle solo for a channel.
 * A channel can't be soloed and muted at the same time — soloing unmutes.
 * Unsoloing also unmutes (never goes back to muted state).
 * WASM owns mute/solo state; we read-modify-write directly in WASM memory.
 */
export function toggleSolo(channel: number): void {
  const engine = getWasmEngine();
  if (!engine?.isReady()) return;

  const { muted, soloed } = engine.readMuteSolo();
  soloed[channel] = !soloed[channel];
  // Always unmute when toggling solo (both on and off)
  if (muted[channel]) {
    muted[channel] = false;
  }
  engine.writeMuteSolo(muted, soloed);
}
