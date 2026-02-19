// Playback actions
export {
  play,
  stop,
  tick,
  togglePlay,
  resetPlayhead,
  scrubToTick,
  scrubEnd,
  setBpm,
  setStepTriggerCallback,
  playExternal,
  externalTick,
  stopExternal,
  getContinueCounter,
  isNoteActive,
  registerWasmActiveNote,
  getHitChancePreview,
  getSubModePreview,
  setNoteOffCallback,
  setWasmEngine,
  getWasmEngine,
} from './playbackActions';
export type { StepTriggerExtras } from './playbackActions';

// Channel actions (mute/solo — still does read-modify-write on WASM memory)
export {
  toggleMute,
  toggleSolo,
} from './channelActions';

// Pattern actions
export {
  clearPattern,
} from './patternActions';

// Scale actions
export {
  cycleScaleRoot,
  cycleScale,
} from './scaleActions';
