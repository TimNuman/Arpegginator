import type { StepTriggerExtras } from "../actions/playbackActions";
import { markDirty } from "../store/renderStore";
import { OledRenderer } from "./OledRenderer";

// ============ WASM Module Types ============

interface WasmModule {
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: number[]) => number;
  HEAPU8: Uint8Array;
  UTF8ToString: (ptr: number) => string;
}

// ============ Rust WASM Adapter ============

/** Wraps a raw WebAssembly.Instance to match the Emscripten-style WasmModule interface. */
class RustWasmAdapter implements WasmModule {
  private instance: WebAssembly.Instance;
  private memory: WebAssembly.Memory;
  private decoder = new TextDecoder();
  HEAPU8: Uint8Array;

  constructor(instance: WebAssembly.Instance) {
    this.instance = instance;
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.HEAPU8 = new Uint8Array(this.memory.buffer);
  }

  /** Refresh typed array views after memory growth. */
  private refreshViews(): void {
    if (this.HEAPU8.buffer !== this.memory.buffer) {
      this.HEAPU8 = new Uint8Array(this.memory.buffer);
    }
  }

  UTF8ToString(ptr: number): string {
    this.refreshViews();
    let end = ptr;
    while (this.HEAPU8[end] !== 0) end++;
    return this.decoder.decode(this.HEAPU8.subarray(ptr, end));
  }

  cwrap(
    name: string,
    _returnType: string | null,
    argTypes: string[],
  ): (...args: number[]) => number {
    const fn = this.instance.exports[name] as Function;
    if (!fn) throw new Error(`WASM export "${name}" not found`);

    const hasStringArgs = argTypes.some((t) => t === "string");
    if (!hasStringArgs) {
      // Wrap to refresh typed array views after call — any WASM function
      // may trigger memory.grow(), detaching the underlying ArrayBuffer.
      return (...args: number[]) => {
        const result = (fn as (...a: number[]) => number)(...args);
        this.refreshViews();
        return result;
      };
    }

    const alloc = this.instance.exports.wasm_alloc as (size: number) => number;
    const free = this.instance.exports.wasm_free as (
      ptr: number,
      size: number,
    ) => void;
    const encoder = new TextEncoder();

    return (...args: unknown[]) => {
      this.refreshViews();
      const allocated: { ptr: number; size: number }[] = [];
      const wasmArgs = args.map((arg, i) => {
        if (argTypes[i] === "string") {
          const encoded = encoder.encode((arg as string) + "\0");
          const ptr = alloc(encoded.length);
          this.refreshViews();
          this.HEAPU8.set(encoded, ptr);
          allocated.push({ ptr, size: encoded.length });
          return ptr;
        }
        return arg as number;
      });
      try {
        const result = fn(...wasmArgs);
        return result;
      } finally {
        this.refreshViews();
        allocated.forEach(({ ptr, size }) => free(ptr, size));
      }
    };
  }
}

/** Load the Rust WASM module directly (no Emscripten glue). */
async function loadRustWasm(
  callbacks: Record<string, Function>,
): Promise<WasmModule> {
  const importObject = {
    env: {
      js_step_trigger: callbacks.stepTrigger ?? (() => {}),
      js_note_off: callbacks.noteOff ?? (() => {}),
      js_set_current_tick: callbacks.setCurrentTick ?? (() => {}),
      js_set_current_patterns: callbacks.setCurrentPatterns ?? (() => {}),
      js_clear_queued_pattern: callbacks.clearQueuedPattern ?? (() => {}),
      js_preview_value: callbacks.previewValue ?? (() => {}),
      js_play_preview_note: callbacks.playPreviewNote ?? (() => {}),
    },
  };

  const base = import.meta.env.BASE_URL ?? "/";
  const response = await fetch(`${base}wasm-rust/engine.wasm`);
  const { instance } = await WebAssembly.instantiateStreaming(
    response,
    importObject,
  );
  return new RustWasmAdapter(instance);
}

export class WasmEngine {
  private module: WasmModule | null = null;

  // Struct layout info (queried from WASM at load time)
  private noteEventSize = 0;
  private fieldOffsets: number[] = [];
  private subModeArraySize = 0;

  // Core functions
  private _engineInit!: () => void;
  private _enginePlayInit!: () => void;
  private _enginePlayInitFromTick!: (tick: number) => void;
  private _engineTick!: () => void;
  private _engineStop!: () => void;
  private _getVersion!: () => number;

  // Buffer accessors
  private _getEventPoolBasePtr!: () => number;
  private _getChannelTypesBuffer!: () => number;
  private _setRngSeed!: (seed: number) => void;
  private _getNoteEventSize!: () => number;
  private _getFieldOffset!: (fieldId: number) => number;
  private _getSubModeArraySize!: () => number;
  private _getPoolBasePtr!: () => number;

  // UI state setters
  private _setZoom!: (tpc: number) => void;
  private _setRowOffset!: (ch: number, offset: number) => void;
  private _setBpm!: (bpm: number) => void;
  private _setSwing!: (swing: number) => void;
  private _setIsPlaying!: (playing: number) => void;
  private _setModifiersHeld!: (mods: number) => void;

  // UI state getters
  private _getCurrentChannel!: () => number;
  private _getBpm!: () => number;
  private _getIsPlaying!: () => number;
  private _setIsExternalPlayback!: (ext: number) => void;
  private _getIsExternalPlayback!: () => number;
  private _getResumeTick!: () => number;
  private _setResumeTick!: (tick: number) => void;

  // Touchstrip
  private _stripStart!: (
    strip: number,
    pos: number,
    shift: number,
    timeMs: number,
  ) => void;
  private _stripMove!: (strip: number, pos: number, timeMs: number) => void;
  private _stripEnd!: (strip: number) => void;

  // Selected event getters (used externally)
  private _getChannelType!: (ch: number) => number;
  private _noteToMidi!: (row: number) => number;
  private _getScaleCount!: () => number;
  private _getScaleZeroIndex!: () => number;

  // Grid output
  private _getButtonValuesBuffer!: () => number;
  private _getColorOverridesBuffer!: () => number;
  private _getGridColorsBuffer!: () => number;
  private _computeGrid!: (timestampMs: number) => void;
  private _isAnimating!: () => number;

  // Input handling
  private _buttonPress!: (row: number, col: number, modifiers: number) => void;
  private _arrowPress!: (direction: number, modifiers: number) => void;
  private _keyAction!: (actionId: number) => void;

  // Grid dimensions (read from WASM — single source of truth)
  private _getVisibleRows!: () => number;
  private _getVisibleCols!: () => number;

  // Edit operations
  private _clearPattern!: () => void;

  // Current tick getter
  private _getCurrentTick!: () => number;

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
    | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onPlayPreviewNote:
    | ((channel: number, row: number, lengthTicks: number) => void)
    | null = null;

  async load(): Promise<void> {
    if (this.module) return;

    // Build callback table
    const callbacks = {
      stepTrigger: (
        ch: number,
        note: number,
        tick: number,
        len: number,
        vel: number,
        timing: number,
        flam: number,
        _evIdx: number,
      ) => {
        if (!this.onStepTrigger) return;
        const extras: StepTriggerExtras = {};
        if (timing !== 0) extras.timingOffsetPercent = timing;
        if (flam > 0) extras.flamCount = flam;
        const hasExtras =
          extras.timingOffsetPercent !== undefined ||
          extras.flamCount !== undefined;
        this.onStepTrigger(
          ch,
          note,
          tick,
          len,
          vel,
          hasExtras ? extras : undefined,
        );
      },
      noteOff: (ch: number, note: number) => {
        this.onNoteOff?.(ch, note);
      },
      setCurrentTick: (_tick: number) => {
        markDirty();
      },
      setCurrentPatterns: (_ptr: number) => {
        markDirty();
      },
      clearQueuedPattern: (_ch: number) => {
        markDirty();
      },
      previewValue: () => {},
      playPreviewNote: (ch: number, row: number, lengthTicks: number) => {
        this.onPlayPreviewNote?.(ch, row, lengthTicks);
      },
    };

    this.module = await loadRustWasm(callbacks);

    // Wire cwrap bindings
    const cw = (name: string, ret: string | null, args: string[]) =>
      this.module!.cwrap(name, ret, args);

    this._engineInit = cw("engine_init", null, []) as unknown as () => void;
    this._enginePlayInit = cw(
      "engine_play_init",
      null,
      [],
    ) as unknown as () => void;
    this._enginePlayInitFromTick = cw("engine_play_init_from_tick", null, [
      "number",
    ]) as unknown as (tick: number) => void;
    this._engineTick = cw("engine_tick", null, []) as unknown as () => void;
    this._engineStop = cw("engine_stop", null, []) as unknown as () => void;
    this._getVersion = cw("engine_get_version", "number", []);
    this._getEventPoolBasePtr = cw(
      "engine_get_event_pool_base_ptr",
      "number",
      [],
    ) as unknown as () => number;
    this._getChannelTypesBuffer = cw(
      "engine_get_channel_types_buffer",
      "number",
      [],
    );
    this._setRngSeed = cw("engine_set_rng_seed", null, [
      "number",
    ]) as unknown as (seed: number) => void;
    this._getNoteEventSize = cw("engine_get_note_event_size", "number", []);
    this._getFieldOffset = cw("engine_get_field_offset", "number", ["number"]);
    this._getSubModeArraySize = cw(
      "engine_get_sub_mode_array_size",
      "number",
      [],
    );
    this._getPoolBasePtr = cw(
      "engine_get_pool_base_ptr",
      "number",
      [],
    ) as unknown as () => number;

    // UI state setters
    this._setZoom = cw("engine_set_zoom", null, ["number"]) as unknown as (
      m: number,
    ) => void;
    this._setRowOffset = cw("engine_set_row_offset", null, [
      "number",
      "number",
    ]) as unknown as (ch: number, o: number) => void;
    this._setBpm = cw("engine_set_bpm", null, ["number"]) as unknown as (
      b: number,
    ) => void;
    this._setSwing = cw("engine_set_swing", null, ["number"]) as unknown as (
      s: number,
    ) => void;
    this._setIsPlaying = cw("engine_set_is_playing", null, [
      "number",
    ]) as unknown as (p: number) => void;
    this._setModifiersHeld = cw("engine_set_modifiers_held", null, [
      "number",
    ]) as unknown as (m: number) => void;

    // UI state getters
    this._getCurrentChannel = cw("engine_get_current_channel", "number", []);
    this._getBpm = cw("engine_get_bpm", "number", []);
    this._getIsPlaying = cw("engine_get_is_playing", "number", []);
    this._setIsExternalPlayback = cw("engine_set_is_external_playback", null, [
      "number",
    ]) as unknown as (e: number) => void;
    this._getIsExternalPlayback = cw(
      "engine_get_is_external_playback",
      "number",
      [],
    );
    this._getResumeTick = cw("engine_get_resume_tick", "number", []);
    this._setResumeTick = cw("engine_set_resume_tick", null, [
      "number",
    ]) as unknown as (t: number) => void;

    // Touchstrip
    this._stripStart = cw("engine_strip_start", null, [
      "number",
      "number",
      "number",
      "number",
    ]) as unknown as (s: number, p: number, sh: number, t: number) => void;
    this._stripMove = cw("engine_strip_move", null, [
      "number",
      "number",
      "number",
    ]) as unknown as (s: number, p: number, t: number) => void;
    this._stripEnd = cw("engine_strip_end", null, ["number"]) as unknown as (
      s: number,
    ) => void;

    // Selected event getters (used externally)
    this._getChannelType = cw("engine_get_channel_type", "number", ["number"]);
    this._noteToMidi = cw("engine_note_to_midi_export", "number", ["number"]);
    this._getScaleCount = cw("engine_get_scale_count", "number", []);
    this._getScaleZeroIndex = cw("engine_get_scale_zero_index", "number", []);
    this._getCurrentTick = cw("engine_get_current_tick", "number", []);

    // Grid output
    this._getButtonValuesBuffer = cw(
      "engine_get_button_values_buffer",
      "number",
      [],
    );
    this._getColorOverridesBuffer = cw(
      "engine_get_color_overrides_buffer",
      "number",
      [],
    );
    this._getGridColorsBuffer = cw(
      "engine_get_grid_colors_buffer",
      "number",
      [],
    );
    this._computeGrid = cw("engine_compute_grid_export", null, [
      "number",
    ]) as unknown as (timestampMs: number) => void;
    this._isAnimating = cw("engine_is_animating_export", "number", []);

    // Input handling
    this._buttonPress = cw("engine_button_press_export", null, [
      "number",
      "number",
      "number",
    ]) as unknown as (r: number, c: number, m: number) => void;
    this._arrowPress = cw("engine_arrow_press_export", null, [
      "number",
      "number",
    ]) as unknown as (d: number, m: number) => void;
    this._keyAction = cw("engine_key_action_export", null, [
      "number",
    ]) as unknown as (a: number) => void;

    // Grid dimensions
    this._getVisibleRows = cw("engine_get_visible_rows", "number", []);
    this._getVisibleCols = cw("engine_get_visible_cols", "number", []);

    // Edit operations
    this._clearPattern = cw(
      "engine_clear_pattern_export",
      null,
      [],
    ) as unknown as () => void;

    // Query struct layout
    this.noteEventSize = this._getNoteEventSize();
    this.subModeArraySize = this._getSubModeArraySize();
    for (let i = 0; i <= 14; i++) {
      this.fieldOffsets[i] = this._getFieldOffset(i);
    }

    console.log(
      "WASM engine loaded (rust), version:",
      this.getVersion(),
      `(NoteEvent: ${this.noteEventSize} bytes, SubModeArray: ${this.subModeArraySize} bytes)`,
    );
  }

  isReady(): boolean {
    return this.module !== null;
  }

  /** Create an OledRenderer backed by the same WASM module */
  createOledRenderer(): OledRenderer {
    if (!this.module) throw new Error("WasmEngine not loaded");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new OledRenderer(this.module as any);
  }

  getVersion(): number {
    return this._getVersion();
  }

  // ============ Core Operations ============

  /** Full init — resets everything including UI state. Call once on load. */
  fullInit(): void {
    this._engineInit();
  }

  /** Playback init — resets only playback state (active notes, counters, tick). */
  init(): void {
    this._enginePlayInit();
  }

  /** Playback init from a specific tick (resume after scrub). */
  initFromTick(tick: number): void {
    this._enginePlayInitFromTick(tick);
  }

  tick(): void {
    this._engineTick();
  }

  stop(): void {
    this._engineStop();
  }

  // ============ Sync Operations ============

  seedRng(): void {
    this._setRngSeed(Math.floor(Math.random() * 0xffffffff) + 1);
  }

  // ============ Grid Rendering ============

  computeGrid(): void {
    this._computeGrid(performance.now());
  }

  isAnimating(): boolean {
    return this._isAnimating() !== 0;
  }

  /**
   * Read the grid output buffers from WASM memory.
   * Dimensions come from WASM (single source of truth).
   */
  readGridBuffers(): {
    buttonValues: number[][];
    colorOverrides: number[][];
    gridColors: number[][];
  } {
    const mod = this.module!;
    const rows = this._getVisibleRows();
    const cols = this._getVisibleCols();
    const bvPtr = this._getButtonValuesBuffer();
    const coPtr = this._getColorOverridesBuffer();
    const gcPtr = this._getGridColorsBuffer();
    const bvView = new Uint16Array(mod.HEAPU8.buffer, bvPtr, rows * cols);
    const coView = new Uint32Array(mod.HEAPU8.buffer, coPtr, rows * cols);
    const gcView = new Uint32Array(mod.HEAPU8.buffer, gcPtr, rows * cols);

    const buttonValues: number[][] = [];
    const colorOverrides: number[][] = [];
    const gridColors: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const bvRow: number[] = [];
      const coRow: number[] = [];
      const gcRow: number[] = [];
      for (let c = 0; c < cols; c++) {
        bvRow.push(bvView[r * cols + c]);
        coRow.push(coView[r * cols + c]);
        gcRow.push(gcView[r * cols + c]);
      }
      buttonValues.push(bvRow);
      colorOverrides.push(coRow);
      gridColors.push(gcRow);
    }
    return { buttonValues, colorOverrides, gridColors };
  }

  // ============ UI State ============

  setZoom(ticksPerCol: number): void {
    this._setZoom(ticksPerCol);
  }
  setRowOffset(ch: number, offset: number): void {
    this._setRowOffset(ch, offset);
  }
  setBpm(bpm: number): void {
    this._setBpm(bpm);
  }
  setSwing(swing: number): void {
    this._setSwing(swing);
  }
  setIsPlaying(playing: boolean): void {
    this._setIsPlaying(playing ? 1 : 0);
  }
  setModifiersHeld(mods: number): void {
    this._setModifiersHeld(mods);
  }

  getCurrentChannel(): number {
    return this._getCurrentChannel();
  }
  getBpm(): number {
    return this._getBpm();
  }
  getIsPlaying(): boolean {
    return this._getIsPlaying() !== 0;
  }
  setIsExternalPlayback(ext: boolean): void {
    this._setIsExternalPlayback(ext ? 1 : 0);
  }
  getIsExternalPlayback(): boolean {
    return this._getIsExternalPlayback() !== 0;
  }
  getResumeTick(): number {
    return this._getResumeTick();
  }
  setResumeTick(tick: number): void {
    this._setResumeTick(tick);
  }

  // Touchstrip
  stripStart(strip: number, pos: number, shift: boolean, timeMs: number): void {
    this._stripStart(strip, pos, shift ? 1 : 0, timeMs);
  }
  stripMove(strip: number, pos: number, timeMs: number): void {
    this._stripMove(strip, pos, timeMs);
  }
  stripEnd(strip: number): void {
    this._stripEnd(strip);
  }

  // Scale/note helpers
  getChannelType(ch: number): number {
    return this._getChannelType(ch);
  }
  noteToMidi(row: number): number {
    return this._noteToMidi(row);
  }
  getScaleCount(): number {
    return this._getScaleCount();
  }
  getScaleZeroIndex(): number {
    return this._getScaleZeroIndex();
  }
  getCurrentTick(): number {
    return this._getCurrentTick();
  }

  // Constants from WASM (single source of truth)
  getVisibleRows(): number {
    return this._getVisibleRows();
  }
  getVisibleCols(): number {
    return this._getVisibleCols();
  }

  /** Write channel types to WASM memory. 0 = melodic, 1 = drum. */
  writeChannelTypes(types: number[]): void {
    const mod = this.module!;
    const ptr = this._getChannelTypesBuffer();
    for (let ch = 0; ch < 6; ch++) {
      mod.HEAPU8[ptr + ch] = types[ch] ?? 0;
    }
  }

  // ============ Input Handling ============

  /** Press a grid button. row/col: 0-indexed visible coords. */
  buttonPress(row: number, col: number, modifiers: number): void {
    this._buttonPress(row, col, modifiers);
  }

  /** Press an arrow key. direction: 0=up, 1=down, 2=left, 3=right. */
  arrowPress(direction: number, modifiers: number): void {
    this._arrowPress(direction, modifiers);
  }

  /** Execute a key action (spacebar, backspace, zoom, etc.). */
  keyAction(actionId: number): void {
    this._keyAction(actionId);
  }

  // ============ Edit Operations ============

  clearPattern(): void {
    this._clearPattern();
  }
}
