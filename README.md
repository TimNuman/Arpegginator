# Arpegginator

Web prototype of a hardware MIDI step sequencer and arpeggiator. The end goal is a standalone device built around a **Teensy 4.1** (ARM Cortex-M7, 600MHz, 1MB RAM) driving a physical grid with RGB LEDs and a reflective memory LCD. This browser version serves as the development environment for the Rust engine -- the same code that runs here as WebAssembly will compile natively for the Teensy.

Place notes on an 8x16 grid, build chords, set up arpeggiation patterns, and send everything out over MIDI to your synths or DAW. The React UI simulates the hardware itself -- an enclosure at true scale carrying the button grid, the panel, the encoders and the transport keys, with host-only controls (tempo, MIDI ports) kept off the case as plain HTML while the Rust engine underneath handles all sequencer state and logic, keeping the path to hardware short.

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

### Sound

- Built-in sounds -- no MIDI hardware needed. Drum channels play an analog-modeled 808 drum synth (kick, snare, clap, hats, toms/congas, cymbals, rimshot/claves, cowbell, maracas, mapped by GM drum note) rendered by the same Rust synth as everything else. Melodic channels play the Rust synth (`arp3-synth`): a polyphonic subtractive engine (selectable waveforms, sub osc, state-variable lowpass, ADSR, glide, drive) compiled to WASM and rendered in an AudioWorklet. Browsers without AudioWorklet fall back to a Web Audio kit and piano (works on e.g. iPad Safari).
- On the Teensy, the _same_ `arp3-synth` crate renders melodic channels through the i.MX RT1062's MQS (Medium Quality Sound) block -- 16-bit 44.1kHz stereo PWM on **pin 10 (right)** and **pin 12 (left)**, driven by a SAI3 FIFO interrupt. Hookup: a first-order RC low-pass per pin (e.g. 1kΩ series + 10nF to ground) into an amp or powered speakers; add a ~10µF DC-blocking cap in series with the output. No codec chip required.
- The Teensy also streams the synth over **USB audio**: the device enumerates as a 44.1kHz 16-bit stereo sound input (same USB audio function as the MIDI interface), so the synth can be monitored or recorded on the computer with no analog wiring at all. The USB stream is a bit-exact tap of what MQS plays.
- **Sound mode** -- per-channel patch editing on the grid (Ctrl + third bottom-row button). The left encoder cycles pages (preset picker, osc 1/2 waveform choosers that draw the wave in LEDs -- Shift+encoder on osc 2 nudges detune -- then amp with vol/mix/sub/glide faders, envelope, filter, FX), the right encoder edits the focused value (Shift for fine), and the grid is directly pressable: fader banks for continuous params, selector rows for waveforms. Edits are audible immediately while the sequencer runs.
- **Presets** -- the first Sound-mode page is a bank of 43 factory patches, color-coded by engine: classic-analog staples (FAT STACK, ACID LINE, RUBBER BASS, STARDUST, HOOVERCRAFT...), NES and SID chip flavors (8-BIT HERO, PIPE DREAM, COIN GET, BREADBIN, SEWER GOBLIN...), 4-op FM sounds (TINE MACHINE, CASTLE BELLS, MECHA BASS, RUST ORGAN...), lo-fi wavetables (OP WON, PHASE DANCER, TAPE GHOST...), additive patches (TONEWHEEL, BELL TOWER, GAMELAN...), and West Coast folder voices (EASEL RIDER, STEEL PAN, FOLD BLOOM, KALIMBA...). Tap a cell or step with the right encoder to load; editing any parameter marks the patch EDITED (amber) and lights a reset cell that restores the preset.
- **Wavefolder** -- a Buchla/Serge-style triangle folder in the shared back end, pre-filter: the FOLD knob (FX page on every engine) drives the signal up to 8x into reflecting boundaries, so harmonics bloom instead of clipping. Identity below unity, so fold 0 is bit-exact clean, and it's a mod-matrix target -- point a WHEEL lane at FOLD for the classic sweep. Drum channels get the same folder per instrument via a FOLD page after the kit chooser -- nine one-column faders (BD, SD, TOM, RS, CP, MA, CB, CY, HH) that draw the kit's fold spectrum on the grid, each press auditioning the drum it folds. Every voice folds against its own envelope, so hits strike folded and decay clean.
- **West Coast engine** -- a fifth synthesis engine built around that folder: a phase-aligned sine-to-triangle core (SHAPE) driven into the fold with adjustable symmetry (SYM offsets into asymmetric folding, DC-blocked) and envelope bloom (BLOOM makes fold depth ride the amp envelope -- strike bright, decay pure, the lowpass-gate gesture). Its FOLD page draws one cycle of the folded core live on the grid (the exact math the DSP runs) with a press-to-jump fold track on the bottom row; WEST holds the fold / shape / sym / bloom faders. The sub oscillator stays clean under the folded core. Presets: EASEL RIDER, STEEL PAN, FOLD BLOOM, WEST BRASS, GOLDEN GATE, KALIMBA (gold in the preset bank).
- **FM engine** -- a second synthesis engine in the style of ALM's Akemie's Castle / the Yamaha YM chips: 4 sine operators, the 8 classic YM2612 algorithms, quantized harmonic ratios (×0.5, ×1..×15), op-1 feedback, and a mod-envelope amount for FM plucks -- through the same sub osc, filter, and drive back end. Loading an FM preset swaps the Sound-mode pages to ALGO (the grid draws the operator routing; bottom row selects algorithms), OP (four ratio faders), and FM (depth / feedback / mod-env / detune faders). The engine follows the preset, so a channel switches engines just by picking a patch.
- **Wavetable engine** -- a third engine in the OP-1's lo-fi digital spirit: a morphing bank of 8 single-cycle tables (sine → triangle → saw → square → pulse → organ → formant → metal), CZ-style phase-distortion warp, and bit-crush with sample-rate decimation. Its WAVE page draws one cycle of the current morphed/warped wave live on the grid (the exact math the DSP runs) with a press-to-jump morph position track on the bottom row; DIGI holds the position / warp / crush / detune faders.
- **Additive engine** -- 16 sine partials with per-harmonic levels and a stretch (inharmonicity) control for bells and gamelan, with automatic muting of partials above Nyquist. Its HARM page turns the grid into a 16-column harmonic editor -- one one-wide fader per partial, draw your spectrum directly on the buttons -- and ADD holds the stretch fader. Presets: TONEWHEEL, GLASS HARP, BELL TOWER, PAN PIPE, BUZZ MACHINE, GAMELAN (rose in the preset bank).
- **808 drum synth** -- an analog-modeled TR-808 kit in the spirit of Tiptop Audio's 808 module line (BD808, SD808, RS808, CP808, MA808, CB808, HH808, CY808 and the tom/conga voices), synthesized in `arp3-synth` from the classic circuit recipes: bridged-T swept sines for kick and toms, dual body sines + snappy noise for the snare, the 6-square Schmitt bank for hats and cymbal (one hi-hat voice, so a closed hat chokes an open one, as on the hardware), the two famous 540/800 Hz squares for the cowbell, and the 3-burst envelope for the clap. Sound mode on a drum channel opens a KIT chooser page followed by one page per instrument -- BD, SD, TOMS, RIM/CLAVE, CLAP, MARACAS, COWBELL, CYMBAL, HI-HAT -- each a fader bank of that module's front-panel knobs (tune / tone / decay / snappy / level, CH+OH decays on the hat page) plus an audition pad in the bottom-right corner (Shift auditions the open hat). Edits stream to the synth live and apply to already-ringing hits.
- **FM drum synth** -- a second kit engine, selectable per channel on the KIT page: a 2-operator phase-modulation kit in the YM-chip / Machinedrum-EFM spirit. Each instrument keeps its page but swaps in an FM knob driving a modulator with its own fast decay -- ratio-1 growl on the kick, an inharmonic x2.43 body on the snare, high-ratio metallic rings for rimshot and cowbell, and a two-stage modulator stack (x5.42 -> x3.52 -> carrier) for the DX-metal cymbal and hats (choke behavior intact). Each kit keeps its own parameter bank, so switching engines never loses knob settings, and a ringing voice finishes on the kit it was struck with.
- **Drum sampler** -- after the instrument pages, the same left-encoder cycle reaches the sampler: 16 sample slots mapped to the GM drum notes (slot 1 = kick 35/36, and so on), so recorded samples replace the 808 recipes note-by-note while empty slots keep the synthesized kit. Five pages: **SLOT** (rows are slots, mirroring the drum lanes -- each loaded row draws its take's waveform across the columns, press a row to select and audition it, Shift+press to snap a pitched sample to the scale root using its auto-detected key), **REC** (arm, record from the browser mic with threshold trigger, pre-roll, and a live scrolling waveform + level meter -- red is reserved for recording), **TRIM** (start/end handles on a press-to-jump track, edits replay the cut), **PLAY** (speed / pitch / level / decay faders, ONE / LOOP / GATE modes, and a GRAIN/TAPE toggle -- granular playback keeps speed and pitch fully independent, TAPE links them as varispeed), and **MOD** (per-slot filter cutoff / resonance / drive). Takes are normalized, key-tagged (YIN pitch detection), and rendered by the same `arp3-synth` crate that will play them from PSRAM on the Teensy, where recording will come from the codec line-in.
- Sends note-on/off to any connected MIDI device via Web MIDI API
- Receives MIDI clock for external sync (start, stop, continue, tempo detection)
- Device selections persist across sessions

### Display

- Simulated **320x240 memory LCD** showing note parameters, chord names, voicings, and playback state -- rendered entirely in Rust and blitted to a canvas via an RGB565 framebuffer, then mapped through a panel simulation so the browser shows what the panel shows. The target panel is a **JDI LPM044M141A**: 4.4", 320x240 over an 89.66 x 67.25 mm active area, reflective, no backlight, and 1 bit per channel. At 0.28 mm per pixel it is coarse enough that the UI is physically large -- a value in Spleen 8x16 stands 2.8 mm tall -- so the design is built for what that panel can show rather than ported onto it.
- **Paper UI** -- white ground, black ink, and no tone in between. There is no grey to dim a label with, so hierarchy comes from size (Spleen 5x8 labels against 8x16 values) and emphasis comes from inversion or a filled slab. Shading is a 4x4 ordered dither, used for areas only -- fader tracks and inactive slots -- never for glyphs or hairlines.
- **Color means live state, never structure.** The only colored pixels on screen are the three modifier buttons along the bottom edge -- blue for the grid, yellow for up/down, magenta for left/right -- plus whichever field the held modifier is currently pointing at, which takes that same color as its well fill. Everything else is black and white. Because color is redundant with the icons and inversion already there, the UI stays complete on a monochrome panel.
- **Bitmap fonts** -- Spleen (BSD-2), parsed straight from BDF at build time into packed 1-bit glyphs. A vector face rasterized at 11px puts stems on fractional coordinates at ~50% coverage, and a 1-bit threshold rounds them away, so `CH` renders as `CII`. Spleen is drawn on the pixel grid, so there is nothing to threshold. The four-size ladder is roughly 12 kB of glyph data against ~175 kB of anti-aliased coverage bytes.
- Color-coded channels on the grid with visual flags for playhead, beat markers, loop boundaries, and selected notes

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React UI (TypeScript)                          │
│  Grid, ButtonGrid, TouchStrip, panel canvas     │
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
- Any modern browser. Built-in sounds work everywhere; MIDI output/sync additionally requires [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) support (Chrome, Edge, Opera)

## Getting Started

```bash
# Install dependencies
npm install

# Build the WASM engine (requires Rust + wasm32-unknown-unknown target)
npm run build:wasm

# Start the dev server
npm run dev
```

Open the app and press play -- built-in 808 + piano sounds work out of the box. To drive external gear instead, pick a MIDI output device in the Out selector in the page's top-right corner (Chrome will prompt for MIDI access).

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
├── wasm-rust/src/     Rust engine crate
│   ├── engine_core    State, pools, types, playback tick processing
│   ├── engine_edit    Note creation/deletion, sub-mode editing, chord ops
│   ├── engine_input   Keyboard/grid input handling, pattern press modes
│   ├── engine_ui      Grid rendering, rendered note cache, coordinate mapping
│   ├── engine_drums   Drum channel logic
│   ├── engine_sound   Sound mode (patch editing pages, presets)
│   ├── engine_sampler Drum sampler pages (SLOT/REC/TRIM/PLAY/MOD)
│   ├── engine_strip   Touch strip handling
│   ├── platform       Platform callbacks (WASM / Teensy / test)
│   ├── oled_*         Display rendering, bitmap fonts, 1-bit graphics primitives
│   └── test_*         Rust unit tests
├── engine/            TypeScript wrappers for WASM module (WasmEngine, OledRenderer)
├── components/        React components (Grid, ButtonGrid, TouchStrip, HostControls)
├── actions/           Playback and pattern actions (transport loop, MIDI scheduling)
├── hooks/             useMidi (Web MIDI I/O + sync), useKeyboard
└── store/             Zustand render store for React<>WASM sync
```

## Tech Stack

- **Rust** -- sequencer engine compiled to WebAssembly (wasm32-unknown-unknown), targeting native ARM (Teensy 4.1)
- **React 19** + **TypeScript** -- UI
- **Vite** -- build tooling
- **Emotion** + **MUI** -- styling
- **Zustand** -- render state coordination
- **webmidi** -- Web MIDI API wrapper
