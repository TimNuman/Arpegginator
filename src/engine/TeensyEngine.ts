// TeensyEngine.ts — Engine backend using Web MIDI to communicate with Teensy 4.1
//
// Architecture:
// - Local WasmEngine handles all rendering (computeGrid, readGridBuffers, OLED)
// - State mutations go to BOTH local WasmEngine AND Teensy via SysEx
// - Teensy drives tick timing (PIT timer) and outputs MIDI to DAW
// - Tick position flows back from Teensy via SysEx to update local engine
// - Browser also runs local tick loop for audio preview callbacks

import type { StepTriggerExtras } from "../actions/playbackActions";
import { markDirty } from "../store/renderStore";
import type { OledRenderer } from "./OledRenderer";
import type { Engine } from "./types";
import { WasmEngine } from "./WasmEngine";
import * as proto from "./midiProtocol";

export class TeensyEngine implements Engine {
  readonly isTeensy = true;

  private wasm: WasmEngine;
  private midiOutput: MIDIOutput | null = null;
  private midiInput: MIDIInput | null = null;
  private connected = false;

  /** Wrap an existing WasmEngine — keeps all patterns and state intact */
  constructor(existingWasm: WasmEngine) {
    this.wasm = existingWasm;
  }

  // Callbacks — suppress step trigger and note off (Teensy handles MIDI output).
  // Only forward preview note for audible feedback when placing notes while stopped.
  private _onStepTrigger:
    | ((
        channel: number,
        midiNote: number,
        tick: number,
        noteLengthTicks: number,
        velocity: number,
        extras?: StepTriggerExtras,
      ) => void)
    | null = null;
  private _onNoteOff: ((channel: number, midiNote: number) => void) | null = null;

  get onStepTrigger() {
    return this._onStepTrigger;
  }
  set onStepTrigger(
    cb:
      | ((
          channel: number,
          midiNote: number,
          tick: number,
          noteLengthTicks: number,
          velocity: number,
          extras?: StepTriggerExtras,
        ) => void)
      | null,
  ) {
    this._onStepTrigger = cb;
    // Don't forward to wasm — Teensy handles MIDI output during playback
    this.wasm.onStepTrigger = null;
  }

  get onNoteOff() {
    return this._onNoteOff;
  }
  set onNoteOff(cb: ((channel: number, midiNote: number) => void) | null) {
    this._onNoteOff = cb;
    this.wasm.onNoteOff = null;
  }

  get onPlayPreviewNote() {
    return this.wasm.onPlayPreviewNote;
  }
  set onPlayPreviewNote(
    cb: ((channel: number, row: number, lengthTicks: number) => void) | null,
  ) {
    this.wasm.onPlayPreviewNote = cb;
  }

  // Connection status callback
  onConnectionChange: ((connected: boolean) => void) | null = null;

  // ============ Lifecycle ============

  async load(): Promise<void> {
    await this.wasm.load();
  }

  isReady(): boolean {
    return this.wasm.isReady() && this.connected;
  }

  /** Connect to Teensy via Web MIDI — looks for "Arp3 Sequencer" device */
  async connect(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI API not available. Use Chrome or Edge.");
    }

    const access = await navigator.requestMIDIAccess({ sysex: true });

    // Find Arp3 Sequencer in MIDI ports
    let output: MIDIOutput | null = null;
    let input: MIDIInput | null = null;

    for (const [, port] of access.outputs) {
      if (port.name?.includes("Arp3")) {
        output = port;
        break;
      }
    }
    for (const [, port] of access.inputs) {
      if (port.name?.includes("Arp3")) {
        input = port;
        break;
      }
    }

    if (!output) {
      throw new Error(
        'Arp3 Sequencer not found. Make sure Teensy is plugged in.',
      );
    }

    this.midiOutput = output;
    this.midiInput = input;

    // Listen for SysEx messages from Teensy
    if (input) {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const data = new Uint8Array(event.data);
        // SysEx messages start with F0
        if (data[0] === 0xf0) {
          const response = proto.decodeSysex(data);
          if (response) {
            this.handleResponse(response);
          }
        }
      };
    }

    // Listen for disconnection
    access.onstatechange = (event: MIDIConnectionEvent) => {
      if (
        event.port &&
        event.port.name?.includes("Arp3") &&
        event.port.state === "disconnected"
      ) {
        this.handleDisconnect();
      }
    };

    this.connected = true;
    this.onConnectionChange?.(true);

    // Request state FROM Teensy (it's the source of truth)
    this.send(proto.encodeGetState());
    // Also sync browser state TO Teensy as fallback (for fresh Teensy)
    this.syncStateToTeensy();

    this.send(proto.encodePing());
    console.log("Teensy connected via Web MIDI");
  }

  /** Send all current WASM engine state to Teensy so it matches */
  private syncStateToTeensy(): void {
    try {
    const bpm = this.wasm.getBpm();
    const swing = this.wasm.getSwing();
    const zoom = this.wasm.getZoom();
    const ch = this.wasm.getCurrentChannel();

    this.send(proto.encodeSetBpm(bpm));
    this.send(proto.encodeSetSwing(swing));
    this.send(proto.encodeSetZoom(zoom));
    this.send(proto.encodeSetCurrentChannel(ch));

    // Channel types
    const types: number[] = [];
    for (let i = 0; i < 6; i++) {
      types.push(this.wasm.getChannelType(i));
    }
    this.send(proto.encodeSetChannelTypes(types));

    // Row offsets for all channels
    for (let i = 0; i < 6; i++) {
      const offset = this.wasm.getRowOffset(i);
      this.send(proto.encodeSetRowOffset(i, offset));
    }

    console.log(`[Teensy sync] bpm=${bpm} zoom=${zoom} ch=${ch} types=[${types}] offsets=[${[0,1,2,3,4,5].map(i => this.wasm.getRowOffset(i).toFixed(3))}]`);
    } catch (e) {
      console.error('[Teensy sync] ERROR:', e);
    }
  }

  disconnect(): void {
    if (this.midiInput) {
      this.midiInput.onmidimessage = null;
    }
    this.midiOutput = null;
    this.midiInput = null;
    this.connected = false;
    this.onConnectionChange?.(false);
    console.log("Teensy disconnected");
  }

  // ============ MIDI I/O ============

  private send(data: Uint8Array): void {
    if (!this.midiOutput) return;
    try {
      this.midiOutput.send(data);
    } catch {
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

  private handleResponse(response: proto.TeensyResponse): void {
    switch (response.type) {
      case "tick":
        this.wasm.setCurrentTick(response.tick);
        this.wasm.setIsPlaying(true);
        markDirty();
        break;

      case "pong":
        console.log("Teensy: pong via MIDI", response);
        break;

      case "state":
        // Apply Teensy's state to local WASM engine
        console.log("[Teensy] state dump:", response);
        this.wasm.setBpm(response.bpm);
        this.wasm.setSwing(response.swing);
        this.wasm.setZoom(response.zoom);
        this.wasm.setIsPlaying(response.isPlaying);
        for (let ch = 0; ch < 6; ch++) {
          this.wasm.setRowOffset(ch, response.rowOffsets[ch]);
        }
        this.wasm.writeChannelTypes(response.channelTypes);
        markDirty();
        break;
    }
  }

  // ============ Playback ============

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
    // Tick local WASM engine for grid rendering (active note highlights).
    // MIDI output goes to DAW from Teensy, not from browser.
    this.wasm.tick();
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
    this.send(proto.encodeSetZoom(ticksPerCol));
  }

  setRowOffset(ch: number, offset: number): void {
    this.wasm.setRowOffset(ch, offset);
    this.send(proto.encodeSetRowOffset(ch, offset));
  }

  setModifiersHeld(mods: number): void {
    this.wasm.setModifiersHeld(mods);
  }

  writeChannelTypes(types: number[]): void {
    this.wasm.writeChannelTypes(types);
    this.send(proto.encodeSetChannelTypes(types));
  }

  // ============ State Getters (local) ============

  getBpm(): number {
    return this.wasm.getBpm();
  }
  getSwing(): number {
    return this.wasm.getSwing();
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
    // Arrow is UI-only (scroll/selection) — no need to send to Teensy
  }

  keyAction(actionId: number): void {
    this.wasm.keyAction(actionId);
    this.send(proto.encodeKeyAction(actionId));
  }

  clearPattern(): void {
    this.wasm.clearPattern();
    // TODO: send pattern clear to Teensy
  }

  // ============ Touch Strip (local only) ============

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
    // Sync row offset to Teensy as user scrolls
    const ch = this.wasm.getCurrentChannel();
    this.send(proto.encodeSetRowOffset(ch, this.wasm.getRowOffset(ch)));
  }
  stripEnd(strip: number): void {
    this.wasm.stripEnd(strip);
    // Final sync of row offset
    const ch = this.wasm.getCurrentChannel();
    this.send(proto.encodeSetRowOffset(ch, this.wasm.getRowOffset(ch)));
  }

  // ============ OLED (local) ============

  createOledRenderer(): OledRenderer {
    return this.wasm.createOledRenderer();
  }
}
