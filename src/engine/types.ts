// types.ts — Engine interface for WASM and Teensy backends

import type { OledRenderer } from "./OledRenderer";
import type { StepTriggerExtras } from "../actions/playbackActions";

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

  // Grid rendering
  computeGrid(): void;
  readGridBuffers(): {
    buttonValues: number[][];
    colorOverrides: number[][];
    gridColors: number[][];
  };
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

  // Callbacks
  onStepTrigger:
    | ((
        channel: number,
        midiNote: number,
        tick: number,
        noteLengthTicks: number,
        velocity: number,
        extras?: StepTriggerExtras,
      ) => void)
    | null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null;
  onPlayPreviewNote:
    | ((channel: number, row: number, lengthTicks: number) => void)
    | null;

  // Backend identification
  readonly isTeensy: boolean;
  disconnect?(): void;
}
