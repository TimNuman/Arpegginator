// TeensyEngine.ts — Engine backend that wraps WasmEngine + WebSerial to Teensy 4.1
//
// Architecture:
// - Local WasmEngine handles all rendering (computeGrid, readGridBuffers, OLED)
// - State mutations go to BOTH local WasmEngine AND Teensy via serial
// - Teensy drives tick timing (PIT timer) and MIDI output
// - Tick position flows back from Teensy to update local engine for display

import type { StepTriggerExtras } from "../actions/playbackActions";
import { markDirty } from "../store/renderStore";
import type { OledRenderer } from "./OledRenderer";
import type { Engine } from "./types";
import { WasmEngine } from "./WasmEngine";
import * as proto from "./serialProtocol";

export class TeensyEngine implements Engine {
  readonly isTeensy = true;

  private wasm = new WasmEngine();
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopActive = false;
  private connected = false;

  // Callbacks (matching Engine interface)
  onStepTrigger:
    | ((
        channel: number,
        midiNote: number,
        tick: number,
        noteLengthTicks: number,
        velocity: number,
        extras?: StepTriggerExtras,
      ) => void)
    | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onPlayPreviewNote:
    | ((channel: number, row: number, lengthTicks: number) => void)
    | null = null;

  // Connection status callback
  onConnectionChange: ((connected: boolean) => void) | null = null;

  // ============ Lifecycle ============

  async load(): Promise<void> {
    await this.wasm.load();
  }

  isReady(): boolean {
    return this.wasm.isReady() && this.connected;
  }

  /** Open WebSerial port picker and connect to Teensy */
  async connect(): Promise<void> {
    if (!("serial" in navigator)) {
      throw new Error("WebSerial API not available. Use Chrome or Edge.");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      if (this.port.writable) {
        this.writer = this.port.writable.getWriter();
      }
      if (this.port.readable) {
        this.reader = this.port.readable.getReader();
      }

      this.connected = true;
      this.onConnectionChange?.(true);
      this.startReadLoop();

      // Ping to verify connection
      await this.send(proto.encodePing());
      console.log("Teensy connected via WebSerial");
    } catch (e) {
      this.connected = false;
      this.onConnectionChange?.(false);
      throw e;
    }
  }

  disconnect(): void {
    this.readLoopActive = false;
    this.connected = false;

    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader.releaseLock();
      this.reader = null;
    }
    if (this.writer) {
      this.writer.close().catch(() => {});
      this.writer.releaseLock();
      this.writer = null;
    }
    if (this.port) {
      this.port.close().catch(() => {});
      this.port = null;
    }

    this.onConnectionChange?.(false);
    console.log("Teensy disconnected");
  }

  // ============ Serial I/O ============

  private async send(data: Uint8Array): Promise<void> {
    if (!this.writer) return;
    try {
      await this.writer.write(data);
    } catch {
      // Connection lost
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.connected) {
      this.connected = false;
      this.onConnectionChange?.(false);
      console.warn("Teensy connection lost");
    }
  }

  private startReadLoop(): void {
    if (this.readLoopActive) return;
    this.readLoopActive = true;

    const rxBuf = new Uint8Array(1024);
    let rxLen = 0;

    const loop = async () => {
      while (this.readLoopActive && this.reader) {
        try {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (!value) continue;

          // Append to buffer
          const space = rxBuf.length - rxLen;
          const toCopy = Math.min(value.length, space);
          rxBuf.set(value.subarray(0, toCopy), rxLen);
          rxLen += toCopy;

          // Process responses
          let offset = 0;
          while (offset < rxLen) {
            const result = proto.decodeResponse(rxBuf, offset, rxLen - offset);
            if (!result) break;
            const [response, consumed] = result;
            offset += consumed;
            this.handleResponse(response);
          }

          // Shift unconsumed bytes to front
          if (offset > 0 && offset < rxLen) {
            rxBuf.copyWithin(0, offset, rxLen);
          }
          rxLen -= offset;
        } catch {
          break;
        }
      }
      this.handleDisconnect();
    };

    loop();
  }

  private handleResponse(response: proto.TeensyResponse): void {
    switch (response.type) {
      case "tick":
        // Update local WASM engine's understanding of current tick
        // We set playing state so computeGrid renders the playhead correctly
        this.wasm.setIsPlaying(true);
        markDirty();
        break;

      case "state":
        // Sync local engine state from Teensy
        if (response.isPlaying) {
          this.wasm.setIsPlaying(true);
        } else {
          this.wasm.setIsPlaying(false);
        }
        this.wasm.setBpm(response.bpm);
        this.wasm.setSwing(response.swing);
        markDirty();
        break;

      case "pong":
        console.log("Teensy: pong");
        break;
    }
  }

  // ============ Playback (Teensy drives timing) ============

  fullInit(): void {
    this.wasm.fullInit();
  }

  init(): void {
    this.wasm.init();
  }

  initFromTick(tick: number): void {
    this.wasm.initFromTick(tick);
  }

  tick(): void {
    // No-op: Teensy drives ticks via PIT timer
  }

  stop(): void {
    this.wasm.stop();
    this.send(proto.encodeStop());
  }

  seedRng(): void {
    this.wasm.seedRng();
  }

  // ============ State Setters (local + Teensy) ============

  setBpm(bpm: number): void {
    this.wasm.setBpm(bpm);
    this.send(proto.encodeSetBpm(bpm));
  }

  setSwing(swing: number): void {
    this.wasm.setSwing(swing);
    this.send(proto.encodeSetSwing(swing));
  }

  setIsPlaying(playing: boolean): void {
    this.wasm.setIsPlaying(playing);
    if (playing) {
      this.send(proto.encodePlay());
    } else {
      this.send(proto.encodeStop());
    }
  }

  setIsExternalPlayback(ext: boolean): void {
    this.wasm.setIsExternalPlayback(ext);
  }

  setResumeTick(tick: number): void {
    this.wasm.setResumeTick(tick);
  }

  setZoom(ticksPerCol: number): void {
    this.wasm.setZoom(ticksPerCol);
  }

  setRowOffset(ch: number, offset: number): void {
    this.wasm.setRowOffset(ch, offset);
  }

  setModifiersHeld(mods: number): void {
    this.wasm.setModifiersHeld(mods);
  }

  writeChannelTypes(types: number[]): void {
    this.wasm.writeChannelTypes(types);
  }

  // ============ State Getters (local) ============

  getBpm(): number {
    return this.wasm.getBpm();
  }
  getIsPlaying(): boolean {
    return this.wasm.getIsPlaying();
  }
  getIsExternalPlayback(): boolean {
    return this.wasm.getIsExternalPlayback();
  }
  getResumeTick(): number {
    return this.wasm.getResumeTick();
  }
  getCurrentChannel(): number {
    return this.wasm.getCurrentChannel();
  }
  getCurrentTick(): number {
    return this.wasm.getCurrentTick();
  }
  getVersion(): number {
    return this.wasm.getVersion();
  }
  getChannelType(ch: number): number {
    return this.wasm.getChannelType(ch);
  }
  noteToMidi(row: number): number {
    return this.wasm.noteToMidi(row);
  }
  getScaleCount(): number {
    return this.wasm.getScaleCount();
  }
  getScaleZeroIndex(): number {
    return this.wasm.getScaleZeroIndex();
  }
  getVisibleRows(): number {
    return this.wasm.getVisibleRows();
  }
  getVisibleCols(): number {
    return this.wasm.getVisibleCols();
  }

  // ============ Grid Rendering (local) ============

  computeGrid(): void {
    this.wasm.computeGrid();
  }
  readGridBuffers(): {
    buttonValues: number[][];
    colorOverrides: number[][];
    gridColors: number[][];
  } {
    return this.wasm.readGridBuffers();
  }
  isAnimating(): boolean {
    return this.wasm.isAnimating();
  }

  // ============ Input (local + Teensy) ============

  buttonPress(row: number, col: number, modifiers: number): void {
    this.wasm.buttonPress(row, col, modifiers);
    this.send(proto.encodeButtonPress(row, col, modifiers));
  }

  arrowPress(direction: number, modifiers: number): void {
    this.wasm.arrowPress(direction, modifiers);
    // No serial command for arrow — it's UI-only (scroll/selection)
  }

  keyAction(actionId: number): void {
    this.wasm.keyAction(actionId);
    this.send(proto.encodeKeyAction(actionId));
  }

  clearPattern(): void {
    this.wasm.clearPattern();
    // TODO: send pattern clear to Teensy when protocol supports it
  }

  // ============ Touch Strip (local only — UI scrolling) ============

  stripStart(
    strip: number,
    pos: number,
    shift: boolean,
    timeMs: number,
  ): void {
    this.wasm.stripStart(strip, pos, shift, timeMs);
  }
  stripMove(strip: number, pos: number, timeMs: number): void {
    this.wasm.stripMove(strip, pos, timeMs);
  }
  stripEnd(strip: number): void {
    this.wasm.stripEnd(strip);
  }

  // ============ OLED (local) ============

  createOledRenderer(): OledRenderer {
    return this.wasm.createOledRenderer();
  }
}
