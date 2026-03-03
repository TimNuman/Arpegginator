# Plan: Rust WASM Engine (completed)

## Status

The C engine has been fully removed and replaced with a Rust WASM engine. There is no longer a dual-engine setup or URL-based engine switching — Rust is the sole engine.

## Architecture

### Directory Layout
```
src/
  wasm-rust/      ← Rust crate (the engine)
    Cargo.toml
    src/
      lib.rs            ← WASM exports + platform callbacks (JS glue)
      engine_core.rs    ← EngineState, init, tick, scrub, scale, arp, voicings
      engine_edit.rs    ← event CRUD, repeat, sub-mode, chord, pattern ops
      engine_ui.rs      ← grid rendering, rendered notes, chord offsets
      engine_input.rs   ← button press, arrow press, key actions, camera follow
      oled_gfx.rs       ← RGB565 framebuffer graphics
      oled_fonts.rs     ← font data (Adafruit GFX format)
      oled_display.rs   ← color/font lookup, exported OLED API
      oled_screen.rs    ← OLED screen content rendering
      test_core.rs      ← core unit tests
      test_edit.rs      ← edit unit tests
      test_rendered.rs  ← rendering unit tests
    build.sh        ← build script (cargo build --target wasm32-unknown-unknown)
  engine/           ← TypeScript wrappers (WasmEngine, OledRenderer)
public/
  wasm-rust/      ← Rust engine output (engine.wasm)
```

## Technical Notes
- The Rust engine compiles to `wasm32-unknown-unknown` (no wasm-bindgen or Emscripten)
- The TypeScript `RustWasmAdapter` in `WasmEngine.ts` wraps the raw `WebAssembly.Instance` to provide an Emscripten-compatible interface (`cwrap`, `HEAPU8`, `UTF8ToString`)
- All state lives in a single global `EngineState` (like the former C version's `g_state`)
- WASM linear memory is read directly by the JS side for grid buffers and UI state
