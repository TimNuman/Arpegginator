# Arpegginator

A browser-based MIDI step sequencer and arpeggiator with a hardware-inspired interface. Place notes on an 8x16 grid, build chords, set up arpeggiation patterns, and send everything out over MIDI to your synths or DAW.

The sequencer engine is written in C and compiled to WebAssembly for performance. The UI is a React app that reads directly from WASM memory each frame, giving you a tight feedback loop between what you see on the grid and what gets played.

## Features

**Sequencing**
- 8 independent channels (6 melodic, 2 drum) with 8 patterns each
- Tick-based timing at 480 PPQN with zoom levels from 1/4 to 1/64 notes
- Per-note repeat system with configurable spacing
- Pattern loops with adjustable start point and length
- Pattern queuing with synchronized switching at loop boundaries
- Mute and solo per channel

**Chords and Arpeggios**
- Stack notes in scale degrees (thirds, fourths, etc.) to build chords
- Multiple chord voicings per interval/size combination
- Inversions (infinite, up, down)
- Arpeggio styles: up, down, up-down, down-up, or all notes together
- Configurable arp voices (how many chord notes play simultaneously per step)

**Per-Repeat Modulation**
Each note has 5 sub-mode arrays that cycle across repeats, each with its own loop behavior (reset, continue, or fill):
- **Velocity** -- per-repeat velocity values
- **Hit chance** -- probability that a repeat fires
- **Timing offset** -- micro-timing nudge as percentage of a step
- **Flam** -- grace note count per repeat
- **Modulate** -- general-purpose modulation value

**Scales**
- Notes are mapped through a configurable scale so the grid always stays in key
- Multiple scale types with root selection by circle of fifths
- Drum channels bypass the scale and map directly to GM MIDI notes

**MIDI**
- Sends note-on/off to any connected MIDI device via Web MIDI API
- Receives MIDI clock for external sync (start, stop, continue, tempo detection)
- Device selections persist across sessions

**Display**
- Simulated 160x128 OLED screen showing note parameters, chord names, voicings, and playback state -- rendered entirely in C and blitted to a canvas via an RGB565 framebuffer
- Color-coded channels on the grid with visual flags for playhead, beat markers, loop boundaries, and selected notes

## Architecture

```
┌─────────────────────────────────────────────┐
│  React UI (TypeScript)                      │
│  Grid, Transport, TouchStrip, OLED canvas   │
├──────────────┬──────────────────────────────┤
│  WasmEngine  │  Actions / Playback loop     │
│  (JS↔C glue) │  (tick scheduling, BPM)      │
├──────────────┴──────────────────────────────┤
│  C Engine (compiled to WASM via Emscripten) │
│  Pattern storage, playback tick processing, │
│  grid computation, input handling, OLED     │
├─────────────────────────────────────────────┤
│  Web MIDI API                               │
│  Note output, clock sync input              │
└─────────────────────────────────────────────┘
```

WASM is the single source of truth for all sequencer state. React reads grid buffers and UI state directly from WASM linear memory on each render. The JS side owns the transport timer loop (1ms `setTimeout`) and MIDI I/O.

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
- [Emscripten](https://emscripten.org/) (for building the WASM engine)
- A browser with [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) support (Chrome, Edge, Opera)

## Getting Started

```bash
# Install dependencies
npm install

# Build the WASM engine (requires Emscripten)
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
```

## Project Structure

```
src/
├── wasm/              C engine source (core, edit, input, UI, OLED)
├── engine/            TypeScript wrappers for WASM module
├── components/        React components (Grid, Transport, ButtonGrid, TouchStrip)
├── actions/           Playback and pattern actions (transport loop, MIDI scheduling)
├── hooks/             useMidi (Web MIDI I/O + sync), useKeyboard
├── store/             Zustand render store for React↔WASM sync
└── types/             NoteEvent, PatternData, scales, drums
```

## Tech Stack

- **C / Emscripten** -- sequencer engine compiled to WebAssembly
- **React 19** + **TypeScript** -- UI
- **Vite** -- build tooling
- **Emotion** + **MUI** -- styling
- **Zustand** -- render state coordination
- **webmidi** -- Web MIDI API wrapper
