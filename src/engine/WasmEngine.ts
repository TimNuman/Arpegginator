import { markDirty } from "../store/renderStore";
import { OledRenderer } from "./OledRenderer";
import type { Engine } from "./types";

// ============ Rust WASM Adapter ============

type WasmExports = Record<string, (...args: number[]) => number> & {
  memory: WebAssembly.Memory;
};

/**
 * Thin wrapper over a raw Rust `WebAssembly.Instance`.
 *
 * The Rust module exports plain numeric functions (no Emscripten glue, no
 * string marshalling), so callers just invoke `module.exports.foo(...)`.
 *
 * Typed-array views must never be cached across calls: any export that runs
 * `wasm_alloc` can `memory.grow()` and detach the underlying ArrayBuffer.
 * `module.buffer` always returns the live buffer, so build fresh views from it
 * at the point of use.
 */
export class WasmModule {
  readonly exports: WasmExports;
  private memory: WebAssembly.Memory;

  constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as WasmExports;
    this.memory = this.exports.memory;
  }

  /** The live WASM heap. Re-read on every use — it detaches on memory.grow(). */
  get buffer(): ArrayBuffer {
    return this.memory.buffer;
  }
}

/** Load the Rust WASM module directly (no Emscripten glue). */
async function loadRustWasm(
  callbacks: Record<string, (...args: number[]) => void>,
): Promise<WasmModule> {
  const importObject = {
    env: {
      js_note_on: callbacks.noteOn ?? (() => {}),
      js_note_off: callbacks.noteOff ?? (() => {}),
      js_midi_cc: callbacks.midiCc ?? (() => {}),
      js_set_current_tick: callbacks.setCurrentTick ?? (() => {}),
      js_set_current_patterns: callbacks.setCurrentPatterns ?? (() => {}),
      js_clear_queued_pattern: callbacks.clearQueuedPattern ?? (() => {}),
      js_preview_value: callbacks.previewValue ?? (() => {}),
      js_play_preview_note: callbacks.playPreviewNote ?? (() => {}),
      js_sound_param: callbacks.soundParam ?? (() => {}),
      js_sample_param: callbacks.sampleParam ?? (() => {}),
      js_drum_param: callbacks.drumParam ?? (() => {}),
      js_rec_control: callbacks.recControl ?? (() => {}),
    },
  };

  const base = import.meta.env.BASE_URL ?? "/";
  const response = await fetch(`${base}wasm-rust/engine.wasm`);
  const { instance } = await WebAssembly.instantiateStreaming(response, importObject);
  return new WasmModule(instance);
}

export class WasmEngine implements Engine {
  readonly isTeensy = false;
  private module: WasmModule | null = null;

  /** Shorthand for the raw WASM exports (asserts module is loaded). */
  private get ex(): WasmExports {
    return this.module!.exports;
  }

  // Cached grid dimensions (queried once at load — they never change).
  private rows = 0;
  private cols = 0;

  // Callbacks. The engine now resolves all timing/flam/lookahead internally and
  // emits fully-scheduled note-ons, so JS just forwards them to MIDI.
  onNoteOn: ((channel: number, midiNote: number, velocity: number) => void) | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onMidiCc: ((channel: number, controller: number, value: number) => void) | null = null;
  onPlayPreviewNote: ((channel: number, row: number, lengthTicks: number) => void) | null = null;
  onSoundParam: ((channel: number, param: number, value: number) => void) | null = null;
  onSampleParam: ((channel: number, slot: number, param: number, value: number) => void) | null =
    null;
  onDrumParam: ((channel: number, param: number, value: number) => void) | null = null;
  onRecControl: ((channel: number, action: number) => void) | null = null;

  async load(): Promise<void> {
    if (this.module) return;

    // Build callback table
    const callbacks = {
      noteOn: (ch: number, note: number, vel: number) => {
        this.onNoteOn?.(ch, note, vel);
      },
      noteOff: (ch: number, note: number) => {
        this.onNoteOff?.(ch, note);
      },
      midiCc: (ch: number, cc: number, value: number) => {
        this.onMidiCc?.(ch, cc, value);
      },
      setCurrentTick: () => {
        markDirty();
      },
      setCurrentPatterns: () => {
        markDirty();
      },
      clearQueuedPattern: () => {
        markDirty();
      },
      previewValue: () => {},
      playPreviewNote: (ch: number, row: number, lengthTicks: number) => {
        this.onPlayPreviewNote?.(ch, row, lengthTicks);
      },
      soundParam: (ch: number, param: number, value: number) => {
        this.onSoundParam?.(ch, param, value);
      },
      sampleParam: (ch: number, slot: number, param: number, value: number) => {
        this.onSampleParam?.(ch, slot, param, value);
      },
      drumParam: (ch: number, param: number, value: number) => {
        this.onDrumParam?.(ch, param, value);
      },
      recControl: (ch: number, action: number) => {
        this.onRecControl?.(ch, action);
      },
    };

    this.module = await loadRustWasm(callbacks);

    // Grid dimensions are fixed for the life of the module.
    this.rows = this.ex.engine_get_visible_rows();
    this.cols = this.ex.engine_get_visible_cols();

    console.log(
      "WASM engine loaded (rust), version:",
      this.getVersion(),
      `(grid ${this.rows}x${this.cols})`,
    );
  }

  isReady(): boolean {
    return this.module !== null;
  }

  /** Create an OledRenderer backed by the same WASM module */
  createOledRenderer(): OledRenderer {
    if (!this.module) throw new Error("WasmEngine not loaded");
    return new OledRenderer(this.module);
  }

  getVersion(): number {
    return this.ex.engine_get_version();
  }

  // ============ Core Operations ============

  /** Full init — resets everything including UI state. Call once on load. */
  fullInit(): void {
    this.ex.engine_init();
  }

  /** Playback init — resets only playback state (active notes, counters, tick). */
  init(): void {
    this.ex.engine_play_init();
  }

  /** Playback init from a specific tick (resume after scrub). */
  initFromTick(tick: number): void {
    this.ex.engine_play_init_from_tick(tick);
  }

  tick(): void {
    this.ex.engine_tick();
  }

  stop(): void {
    this.ex.engine_stop();
  }

  // ============ Sync Operations ============

  seedRng(): void {
    this.ex.engine_set_rng_seed(Math.floor(Math.random() * 0xffffffff) + 1);
  }

  // ============ Grid Rendering ============

  computeGrid(): void {
    this.ex.engine_compute_grid_export(performance.now());
  }

  isAnimating(): boolean {
    return this.ex.engine_is_animating_export() !== 0;
  }

  /**
   * Return a live view of the ARGB grid colors (row-major, length rows*cols).
   *
   * This is a view directly onto WASM memory — read it immediately and don't
   * retain it across other WASM calls. Index as `colors[row * cols + col]`.
   */
  getGridColors(): Uint32Array {
    const ptr = this.ex.engine_get_grid_colors_buffer();
    return new Uint32Array(this.module!.buffer, ptr, this.rows * this.cols);
  }

  // ============ UI State ============

  setZoom(ticksPerCol: number): void {
    this.ex.engine_set_zoom(ticksPerCol);
  }
  setRowOffset(ch: number, offset: number): void {
    this.ex.engine_set_row_offset(ch, offset);
  }
  setBpm(bpm: number): void {
    this.ex.engine_set_bpm(bpm);
  }
  setSwing(swing: number): void {
    this.ex.engine_set_swing(swing);
  }
  setIsPlaying(playing: boolean): void {
    this.ex.engine_set_is_playing(playing ? 1 : 0);
  }
  setModifiersHeld(mods: number): void {
    this.ex.engine_set_modifiers_held(mods);
  }

  getCurrentChannel(): number {
    return this.ex.engine_get_current_channel();
  }
  getBpm(): number {
    return this.ex.engine_get_bpm();
  }
  getSwing(): number {
    return this.ex.engine_get_swing();
  }
  getZoom(): number {
    return this.ex.engine_get_zoom();
  }
  getRowOffset(ch: number): number {
    return this.ex.engine_get_row_offset(ch);
  }
  getIsPlaying(): boolean {
    return this.ex.engine_get_is_playing() !== 0;
  }
  setIsExternalPlayback(ext: boolean): void {
    this.ex.engine_set_is_external_playback(ext ? 1 : 0);
  }
  getIsExternalPlayback(): boolean {
    return this.ex.engine_get_is_external_playback() !== 0;
  }
  getResumeTick(): number {
    return this.ex.engine_get_resume_tick();
  }
  setResumeTick(tick: number): void {
    this.ex.engine_set_resume_tick(tick);
  }

  // Touchstrip
  stripStart(strip: number, pos: number, shift: boolean, timeMs: number): void {
    this.ex.engine_strip_start(strip, pos, shift ? 1 : 0, timeMs);
  }
  stripMove(strip: number, pos: number, timeMs: number): void {
    this.ex.engine_strip_move(strip, pos, timeMs);
  }
  stripEnd(strip: number): void {
    this.ex.engine_strip_end(strip);
  }

  // Scale/note helpers
  getChannelType(ch: number): number {
    return this.ex.engine_get_channel_type(ch);
  }
  noteToMidi(row: number): number {
    return this.ex.engine_note_to_midi_export(row);
  }
  getScaleCount(): number {
    return this.ex.engine_get_scale_count();
  }
  getScaleZeroIndex(): number {
    return this.ex.engine_get_scale_zero_index();
  }
  getCurrentTick(): number {
    return this.ex.engine_get_current_tick();
  }
  setCurrentTick(tick: number): void {
    this.ex.engine_set_current_tick(tick);
  }

  // Constants from WASM (single source of truth)
  getVisibleRows(): number {
    return this.rows;
  }
  getVisibleCols(): number {
    return this.cols;
  }

  /**
   * Function hint for an on-screen modifier key, mirroring the OLED legend.
   * `key`/`held` use the OLED modifier encoding (shift=1, meta=2, alt=4,
   * ctrl=8). The export returns a null-terminated string in WASM memory.
   */
  getModifierHint(key: number, held: number): string {
    const ptr = this.ex.engine_modifier_hint(key, held);
    const heap = new Uint8Array(this.module!.buffer);
    let end = ptr;
    while (heap[end] !== 0) end++;
    return new TextDecoder().decode(heap.subarray(ptr, end));
  }

  /** Write channel types to WASM memory. 0 = melodic, 1 = drum. */
  writeChannelTypes(types: number[]): void {
    const ptr = this.ex.engine_get_channel_types_buffer();
    const heap = new Uint8Array(this.module!.buffer);
    for (let ch = 0; ch < 6; ch++) {
      heap[ptr + ch] = types[ch] ?? 0;
    }
  }

  // ============ Input Handling ============

  /** Press a grid button. row/col: 0-indexed visible coords. */
  buttonPress(row: number, col: number, modifiers: number): void {
    this.ex.engine_button_press_export(row, col, modifiers);
  }

  /** Press an arrow key. direction: 0=up, 1=down, 2=left, 3=right. */
  arrowPress(direction: number, modifiers: number): void {
    this.ex.engine_arrow_press_export(direction, modifiers);
  }

  /** Execute a key action (spacebar, backspace, zoom, etc.). */
  keyAction(actionId: number): void {
    this.ex.engine_key_action_export(actionId);
  }

  // ============ Edit Operations ============

  clearPattern(): void {
    this.ex.engine_clear_pattern_export();
  }

  // ============ Sound Mode ============

  /** Re-emit all patch params via onSoundParam (e.g. when the synth loads). */
  syncSoundParams(): void {
    this.ex.engine_sync_sound_params();
  }

  // ============ Drum Sampler ============

  /** Selected sampler slot on a drum channel (the recording target). */
  getSamplerSlot(ch: number): number {
    return this.ex.engine_get_sampler_slot(ch);
  }

  /** Push a take's 16-bucket waveform preview for the SLOT page grid. */
  setSlotPreview(ch: number, slot: number, buckets: Uint8Array): void {
    const ptr = this.ex.engine_get_slot_preview_buffer(ch, slot);
    if (!ptr) return;
    new Uint8Array(this.module!.buffer, ptr, 16).set(buckets.subarray(0, 16));
  }

  /** Mark a slot loaded/empty with its detected key (0-11, -1 = unknown). */
  setSlotState(ch: number, slot: number, loaded: boolean, key: number): void {
    this.ex.engine_set_slot_state(ch, slot, loaded ? 1 : 0, key);
  }

  /** Recorder feedback: state (0 idle / 1 armed / 2 recording) + level 0-255. */
  setRecState(state: number, level: number): void {
    this.ex.engine_set_rec_state(state, level);
  }

  /** Live 16-bucket waveform shown on the REC page while armed/recording. */
  setRecWaveform(buckets: Uint8Array): void {
    const ptr = this.ex.engine_get_rec_waveform_buffer();
    new Uint8Array(this.module!.buffer, ptr, 16).set(buckets.subarray(0, 16));
  }
}
