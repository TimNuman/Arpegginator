# Arpegginator

Web prototype of a hardware MIDI step sequencer and arpeggiator. The end goal is a standalone device built around a **Teensy 4.1** (ARM Cortex-M7, 600MHz, 1MB RAM) driving a physical grid with RGB LEDs and an OLED display. This browser version serves as the development environment for the Rust engine -- the same code that runs here as WebAssembly will compile natively for the Teensy.

Place notes on an 8x16 grid, build chords, set up arpeggiation patterns, and send everything out over MIDI to your synths or DAW. The React UI simulates the hardware interface (button grid, display, transport controls) while the Rust engine underneath handles all sequencer state and logic, keeping the path to hardware short.

## Features

### Sequencing

- 6 channels (4 melodic, 2 drum) with 8 patterns each
- Tick-based timing at 480 PPQN with zoom levels from 1/4 to 1/64 notes
- Per-note repeat system with configurable spacing
- Pattern loops with adjustable start point and length
- Pattern queuing with synchronized switching at loop boundaries
- Mute and solo per channel

### Chords and Arpeggios

- Stack notes in scale degrees (thirds, fourths, etc.) to build chords
- Multiple chord voicings per interval/size combination
- Inversions (infinite, up, down)
- Arpeggio styles: up, down, up-down, down-up, or all notes together
- Configurable arp voices (how many chord notes play simultaneously per step)

### Per-Repeat Modulation

Each note has 5 sub-mode arrays that cycle across repeats, each with its own loop behavior (reset, continue, or fill):

- **Velocity** -- per-repeat velocity values
- **Hit chance** -- probability that a repeat fires
- **Timing offset** -- micro-timing nudge as percentage of a step
- **Flam** -- grace note count per repeat
- **Modulate** -- pitch transposition in half steps

### Scales

- Notes are mapped through a configurable scale so the grid always stays in key
- Multiple scale types with root selection by circle of fifths
- Drum channels bypass the scale and map directly to GM MIDI notes

### MIDI

- Sends note-on/off to any connected MIDI device via Web MIDI API
- Receives MIDI clock for external sync (start, stop, continue, tempo detection)
- Device selections persist across sessions

### Display

- Simulated 160x128 OLED screen showing note parameters, chord names, voicings, and playback state -- rendered entirely in Rust and blitted to a canvas via an RGB565 framebuffer
- Color-coded channels on the grid with visual flags for playhead, beat markers, loop boundaries, and selected notes

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React UI (TypeScript)                          │
│  Grid, Transport, TouchStrip, OLED canvas       │
├──────────────┬──────────────────────────────────┤
│  WasmEngine  │  Actions / Playback loop         │
│  (JS<>Rust)  │  (tick scheduling, BPM)          │
├──────────────┴──────────────────────────────────┤
│  Rust Engine (wasm32 / ARM Cortex-M7)           │
│  Pattern storage, playback tick processing,     │
│  grid computation, input handling, OLED         │
├─────────────────────────────────────────────────┤
│  Platform layer (cfg-switched per target)       │
│  WASM: JS callbacks | Teensy: hardware MIDI     │
├─────────────────────────────────────────────────┤
│  Web MIDI API (browser) / USB MIDI (Teensy)     │
└─────────────────────────────────────────────────┘
```

The Rust engine is the single source of truth for all sequencer state. In the browser, React reads grid buffers and UI state directly from WASM linear memory on each render. The JS side owns the transport timer loop (1ms `setTimeout`) and MIDI I/O. On Teensy, the engine runs natively at 600MHz with hardware MIDI output.

### Platform Abstraction

The engine uses `#[cfg(target_arch)]` to switch between platform backends:

- **wasm32** -- calls JS imports via `extern "C"` for MIDI output and UI callbacks
- **arm** -- (planned) direct hardware MIDI and GPIO for Teensy 4.1
- **test** -- no-op stubs for unit testing

### Teensy 4.1 Constraints

The engine is designed to fit within the Teensy's 1MB RAM budget:

- All state lives in fixed-size arrays (no heap allocation required)
- Pool allocators for NoteEvents (1024 slots) and SubModeArrays (512 slots) with graceful degradation on exhaustion
- `f32` only (Cortex-M7 has hardware FPU for single-precision, not double)
- Optimized alpha blending with bitshift instead of division

## Controls

The grid maps to your keyboard like a controller:

```
Row 4:  1 2 3 4 5 6 7 8
Row 5:  Q W E R T Y U I
Row 6:  A S D F G H J K
Row 7:  Z X C V B N M ,
```

Other keys:

- **Space** -- play / stop
- **Arrow keys** -- navigate (with modifiers for mode-specific actions)
- **Backspace** -- deselect / reset
- **Delete** -- delete selected note
- **[ / ]** -- zoom out / in
- **Shift, Ctrl, Alt, Cmd** -- modifier keys for extended actions (shown in the UI)

The grid also responds to mouse clicks and touch input with drag support.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- A browser with [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) support (Chrome, Edge, Opera)

## Getting Started

```bash
# Install dependencies
npm install

# Build the WASM engine (requires Rust + wasm32-unknown-unknown target)
npm run build:wasm

# Start the dev server
npm run dev
```

Open the app in Chrome and grant MIDI access when prompted. Select a MIDI output device in the transport bar to start sending notes.

## Build

```bash
# Full production build (WASM + TypeScript + Vite)
npm run build

# WASM only
npm run build:wasm

# Watch WASM sources for changes during development
npm run watch:wasm

# Run Rust unit tests
npm run test:rust
```

## Project Structure

```
src/
├── wasm-rust/         Rust engine crate (core, edit, input, UI, OLED, platform)
├── engine/            TypeScript wrappers for WASM module
├── components/        React components (Grid, Transport, ButtonGrid, TouchStrip)
├── actions/           Playback and pattern actions (transport loop, MIDI scheduling)
├── hooks/             useMidi (Web MIDI I/O + sync), useKeyboard
├── store/             Zustand render store for React<>WASM sync
└── types/             NoteEvent, PatternData, scales, drums
```

## Tech Stack

- **Rust** -- sequencer engine compiled to WebAssembly (wasm32-unknown-unknown), targeting native ARM (Teensy 4.1)
- **React 19** + **TypeScript** -- UI
- **Vite** -- build tooling
- **Emotion** + **MUI** -- styling
- **Zustand** -- render state coordination
- **webmidi** -- Web MIDI API wrapper
