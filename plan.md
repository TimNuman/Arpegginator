# Plan: Rust WASM Engine alongside existing C WASM Engine

## Goal
Create a Rust WASM version of the arpeggiator engine that lives alongside the existing C code. Users can switch between `?engine=c` (default) and `?engine=rust` via URL query parameter.

## Architecture

### Key Insight: Same JS Interface
Both engines expose the same exported WASM functions and use the same JS callback mechanism. The TypeScript `WasmEngine` class loads one or the other based on URL param but the API is identical.

### Directory Layout
```
src/
  wasm/           ← existing C code (untouched)
  wasm-rust/      ← new Rust crate
    Cargo.toml
    src/
      lib.rs            ← #[wasm_bindgen] exports + platform callbacks (JS glue)
      engine_core.rs    ← EngineState, init, tick, scrub, scale, arp, voicings
      engine_edit.rs    ← event CRUD, repeat, sub-mode, chord, pattern ops
      engine_ui.rs      ← grid rendering, rendered notes, chord offsets
      engine_input.rs   ← button press, arrow press, key actions, camera follow
      oled_gfx.rs       ← RGB565 framebuffer graphics
      oled_fonts.rs     ← font data (Adafruit GFX format)
      oled_display.rs   ← color/font lookup, exported OLED API
      oled_screen.rs    ← OLED screen content rendering
    build.sh        ← wasm-pack build script
public/
  wasm/           ← C engine output (engine.js + engine.wasm)
  wasm-rust/      ← Rust engine output (engine_rust.js + engine_rust_bg.wasm)
```

## Implementation Steps

### 1. Setup Rust Tooling
- Install `wasm32-unknown-unknown` target
- Install `wasm-pack`
- Create `src/wasm-rust/` crate with `Cargo.toml` (deps: `wasm-bindgen`)

### 2. Port Core Types & Constants (`engine_core.rs`)
- All constants (NUM_CHANNELS, MAX_EVENTS, button flags, etc.)
- All enums (LoopMode, ChannelType, SubModeId, UiMode, ZoomLevel, ARP styles)
- All structs (SubModeArray, NoteEvent, PatternData, PatternLoop, ActiveNote, RenderedNote, EngineState)
- Scale data tables (SCALE_PATTERNS, SCALE_NAMES)
- Voicing tables
- Core functions: init, play_init, tick, stop, scrub, scale rebuild/cycle, arp logic, active notes

### 3. Port Edit Operations (`engine_edit.rs`)
- Event CRUD (toggle, remove, move, set_length, place)
- Repeat operations (set_amount, set_space)
- Sub-mode operations (set_value, set_length, toggle_loop_mode)
- Chord operations (adjust_stack, adjust_space, cycle_inversion, cycle_voicing, cycle_arp)
- Pattern operations (copy, clear)

### 4. Port UI Rendering (`engine_ui.rs`)
- Sub-mode render configs
- Level generation
- Chord offset computation (with inversions)
- Rendered notes expansion + capping
- Grid rendering (pattern, channel, loop, modify modes)
- Camera easing

### 5. Port Input Handling (`engine_input.rs`)
- Coordinate conversion (visible→actual row/tick)
- Event finding (at position, overlapping, by chord)
- Button press dispatch (pattern, channel, loop, modify modes)
- Arrow press dispatch (move, resize, chord adjust, arp, scale cycle)
- Key actions (play toggle, deselect, zoom, delete, clear)
- Camera follow logic

### 6. Port OLED (`oled_gfx.rs`, `oled_fonts.rs`, `oled_display.rs`, `oled_screen.rs`)
- Framebuffer graphics primitives
- Font data and text rendering
- Display API with color/font indices
- Screen content rendering

### 7. WASM Exports (`lib.rs`)
- Global `EngineState` (behind `once_cell` or `static mut`)
- All exported functions matching the C WASM API exactly
- JS callback bridges via `#[wasm_bindgen]` extern blocks
- Buffer accessor functions returning pointers into WASM linear memory

### 8. Build Integration
- `src/wasm-rust/build.sh` using wasm-pack
- Add `build:wasm-rust` npm script
- Output to `public/wasm-rust/`

### 9. TypeScript Engine Switching
- Modify `WasmEngine.ts` `load()` to check `URLSearchParams` for `engine=rust`
- Load either `/wasm/engine.js` (C) or `/wasm-rust/engine_rust.js` (Rust)
- Same `WasmEngine` class, different WASM backing

### 10. Test Parity
- Port existing C tests to Rust unit tests (`#[cfg(test)]`)
- Verify identical behavior between C and Rust engines

## Scope of First Commit
Steps 1-9 (full port + URL switching). The OLED module (step 6) will be included since it's part of the WASM build. Tests (step 10) as Rust unit tests.

## Technical Notes
- Use `wasm-bindgen` for JS interop instead of Emscripten
- The Rust version exposes the same function signatures so the TS `WasmEngine` class needs minimal changes
- All state lives in a single global `EngineState` (like the C version's `g_state`)
- Memory layout for shared buffers (events, loops, etc.) must match so JS can read them the same way — OR we adapt the JS reading to use wasm-bindgen's approach
- Since wasm-bindgen uses a different module loading pattern than Emscripten, the `WasmEngine.ts` load path will diverge slightly for each engine type
