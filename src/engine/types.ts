// types.ts — Engine interface for WASM and Teensy backends

import type { OledRenderer } from "./OledRenderer";

/**
 * Abstraction over the sequencer engine backend.
 * Implemented by WasmEngine (browser-only) and TeensyEngine (USB serial).
 */
export interface Engine {
  // Lifecycle
  load(): Promise<void>;
  isReady(): boolean;

  // Playback
  fullInit(): void;
  init(): void;
  initFromTick(tick: number): void;
  tick(): void;
  stop(): void;
  seedRng(): void;

  // State setters
  setBpm(bpm: number): void;
  setSwing(swing: number): void;
  setIsPlaying(playing: boolean): void;
  setIsExternalPlayback(ext: boolean): void;
  setResumeTick(tick: number): void;
  setZoom(ticksPerCol: number): void;
  setRowOffset(ch: number, offset: number): void;
  setModifiersHeld(mods: number): void;
  writeChannelTypes(types: number[]): void;

  // State getters
  getBpm(): number;
  getIsPlaying(): boolean;
  getIsExternalPlayback(): boolean;
  getResumeTick(): number;
  getCurrentChannel(): number;
  getCurrentTick(): number;
  getVersion(): number;
  getChannelType(ch: number): number;
  noteToMidi(row: number): number;
  getScaleCount(): number;
  getScaleZeroIndex(): number;
  getVisibleRows(): number;
  getVisibleCols(): number;
  /** Function hint for an on-screen modifier key (OLED legend wording, OLED mod encoding). */
  getModifierHint(key: number, held: number): string;

  // Grid rendering
  computeGrid(): void;
  /** Live view of ARGB grid colors, row-major (length rows*cols). Read immediately. */
  getGridColors(): Uint32Array;
  isAnimating(): boolean;

  // Input
  buttonPress(row: number, col: number, modifiers: number): void;
  arrowPress(direction: number, modifiers: number): void;
  keyAction(actionId: number): void;
  clearPattern(): void;

  // Touch strip
  stripStart(strip: number, pos: number, shift: boolean, timeMs: number): void;
  stripMove(strip: number, pos: number, timeMs: number): void;
  stripEnd(strip: number): void;

  // OLED
  createOledRenderer(): OledRenderer;

  // Sound mode: re-emit all patch params via onSoundParam
  syncSoundParams(): void;

  // Drum sampler (browser recording path feeds engine UI state)
  /** Selected sampler slot on a drum channel (the recording target). */
  getSamplerSlot(ch: number): number;
  /** Push a take's 16-bucket waveform preview for the SLOT page grid. */
  setSlotPreview(ch: number, slot: number, buckets: Uint8Array): void;
  /** Mark a slot loaded/empty with its detected key (0-11, -1 = unknown). */
  setSlotState(ch: number, slot: number, loaded: boolean, key: number): void;
  /** Recorder feedback: state (0 idle / 1 armed / 2 recording) + level 0-255. */
  setRecState(state: number, level: number): void;
  /** Live 16-bucket waveform shown on the REC page while armed/recording. */
  setRecWaveform(buckets: Uint8Array): void;

  // Callbacks. The engine emits fully-scheduled note-ons (timing/flam/lookahead
  // resolved internally); JS just forwards to MIDI.
  onNoteOn: ((channel: number, midiNote: number, velocity: number) => void) | null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null;
  /** Control change from the engine (e.g. the WHEEL lane as CC1) — forward to MIDI out */
  onMidiCc: ((channel: number, controller: number, value: number) => void) | null;
  onPlayPreviewNote: ((channel: number, row: number, lengthTicks: number) => void) | null;
  /** Synth patch param changed (Sound mode edit or sync) — forward to audio */
  onSoundParam: ((channel: number, param: number, value: number) => void) | null;
  /** Sampler slot param changed (Sound mode edit or sync) — forward to audio */
  onSampleParam:
    | ((channel: number, slot: number, param: number, value: number) => void)
    | null;
  /** REC cell pressed on the sampler's REC page — toggle the recorder */
  onRecControl: ((channel: number, action: number) => void) | null;

  // Backend identification
  readonly isTeensy: boolean;
  disconnect?(): void;
}
