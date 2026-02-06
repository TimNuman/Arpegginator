# ARP3 Implementation Plan

A comprehensive guide for building ARP3, a web-based MIDI step sequencer with 8 channels, pattern management, and hardware-style grid interface.

---

## Overview

ARP3 is a polyphonic step sequencer designed for live performance and music production. It features:

- 8 independent MIDI channels
- 8 patterns per channel
- Variable note lengths
- Per-pattern loop boundaries
- Pattern queuing with synchronized switching
- Hardware-style grid interface with scrolling
- Keyboard shortcuts for rapid input

---

## Tech Stack

### Dependencies

```json
{
  "dependencies": {
    "@emotion/react": "^11.14.0",
    "@emotion/styled": "^11.14.1",
    "@mui/icons-material": "^7.3.7",
    "@mui/material": "^7.3.7",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "webmidi": "^3.1.14"
  },
  "devDependencies": {
    "@emotion/babel-plugin": "^11.13.5",
    "@vitejs/plugin-react": "^5.1.1",
    "typescript": "~5.9.3",
    "vite": "^7.2.4"
  }
}
```

### Build Configuration

- Vite with React plugin
- TypeScript strict mode
- Emotion CSS-in-JS with Babel plugin for optimizations

---

## Phase 1: Project Setup & Type Definitions

### 1.1 Initialize Project

```bash
npm create vite@latest arp3 -- --template react-ts
cd arp3
npm install @emotion/react @emotion/styled @mui/material @mui/icons-material webmidi
npm install -D @emotion/babel-plugin
```

### 1.2 Configure Vite

Update `vite.config.ts`:

- Add `jsxImportSource: '@emotion/react'`
- Configure Emotion Babel plugin

### 1.3 Define Type Definitions (`src/types/grid.ts`)

```typescript
// Note value: 0 = off, positive number = note length in steps
export type NoteValue = number;

// Grid state: 2D array of notes [row][col]
export type GridState = NoteValue[][];

// Loop boundaries for a pattern
export interface PatternLoop {
  start: number; // Starting column (0-63)
  length: number; // Number of columns in loop (1-64)
}

// Constants
export const TOTAL_ROWS = 128; // Full MIDI range
export const TOTAL_COLS = 64; // Steps per pattern
export const VISIBLE_ROWS = 8; // Grid height on screen
export const VISIBLE_COLS = 16; // Grid width on screen
export const NUM_CHANNELS = 8; // Independent channels
export const PATTERNS_PER_CHANNEL = 8;
export const DEFAULT_LOOP_START = 0;
export const DEFAULT_LOOP_LENGTH = 16;
```

---

## Phase 2: MIDI Integration Hook

### 2.1 Create `src/hooks/useMidi.ts`

**Purpose:** Handle WebMIDI connection, device selection, and note output.

**State:**

- `midiEnabled: boolean` - Whether WebMIDI is available
- `midiOutputs: Output[]` - Available MIDI output devices
- `selectedOutput: Output | null` - Currently selected output

**Functions:**

- `playNote(note: number, velocity: number, channel: number, duration?: number)`
  - Sends MIDI note-on, schedules note-off after duration
  - Channel is 1-indexed (app channel 0 = MIDI channel 1)
- `stopNote(note: number, channel: number)`
  - Sends MIDI note-off
- `stopAllNotes()`
  - Sends CC 120 (All Notes Off) on all 16 MIDI channels
- `setSelectedOutput(output: Output)`
  - Changes active MIDI output

**Implementation Notes:**

- Use `WebMidi.enable()` on mount
- Listen for device connect/disconnect events
- Track active notes in a ref to prevent stuck notes
- Auto-select first available output

---

## Phase 3: Sequencer Logic Hook

### 3.1 Create `src/hooks/useSequencer.ts`

**Purpose:** Core sequencer state and playback timing.

**State:**

```typescript
// Pattern data: channels[channel][pattern] = GridState
channels: GridState[][]

// Current selections
currentChannel: number           // 0-7
currentPatterns: number[]        // Active pattern per channel [8]

// Playback
isPlaying: boolean
bpm: number                      // 40-240
currentStep: number              // -1 when stopped, 0-63 when playing

// Loop boundaries: patternLoops[channel][pattern]
patternLoops: PatternLoop[][]

// Queued patterns for each channel (null = no queue)
queuedPatterns: (number | null)[]
```

**Refs (for stable callback access):**

- `channelsRef` - Mirrors channels state
- `currentPatternsRef` - Mirrors currentPatterns
- `patternLoopsRef` - Mirrors patternLoops

**Core Logic - `tick()` function:**

1. Calculate next step
2. For each channel:
   - Get current loop boundaries
   - Calculate looped step: `start + (((step - start) % length + length) % length)`
   - If at loop start and pattern queued, switch pattern
   - Check for notes at looped step
   - Trigger notes via MIDI with calculated duration

**Step Duration Calculation:**

```typescript
const stepDuration = ((60 / bpm) * 1000) / 4; // 16th notes
const noteDuration = stepDuration * (noteLength - 0.1); // Small gap between notes
```

**Exposed Functions:**

- `togglePlay()` - Start/stop playback
- `resetPlayhead()` - Set currentStep to -1
- `setBpm(bpm: number)` - Update tempo
- `setChannel(channel: number)` - Switch active channel
- `setPattern(channel: number, pattern: number)` - Immediate or queued switch
- `queuePattern(channel: number, pattern: number)` - Queue pattern for loop start
- `toggleCell(row: number, col: number)` - Toggle note on/off
- `setNote(row: number, col: number, length: number)` - Set note with specific length
- `setPatternLoop(channel: number, pattern: number, start: number, length: number)`
- `clearPattern(channel: number, pattern: number)` - Clear all notes

---

## Phase 4: Transport Component

### 4.1 Create `src/components/Transport.tsx`

**Purpose:** Playback controls, BPM, and MIDI device selection.

**Layout:**

```
[Play/Stop] [Clear] | BPM: [===slider===] 120 | MIDI: [dropdown]
```

**Props:**

```typescript
interface TransportProps {
  isPlaying: boolean;
  bpm: number;
  midiOutputs: Output[];
  selectedOutput: Output | null;
  onTogglePlay: () => void;
  onClear: () => void;
  onBpmChange: (bpm: number) => void;
  onMidiOutputChange: (output: Output) => void;
}
```

**Styling:**

- Dark gradient background (#1a1a1a to #0d0d0d)
- Green play button, red when playing
- BPM slider 40-240 range
- MIDI dropdown disabled when no outputs

---

## Phase 5: TouchStrip Component

### 5.1 Create `src/components/TouchStrip.tsx`

**Purpose:** Scrollable strip with inertial physics for grid navigation.

**Props:**

```typescript
interface TouchStripProps {
  value: number; // 0-1 normalized position
  onChange: (value: number) => void;
  orientation: "horizontal" | "vertical";
  length: number; // Length in pixels
}
```

**Physics Constants:**

```typescript
const FRICTION = 0.94; // Velocity decay per frame
const MIN_VELOCITY = 0.0008; // Stop threshold
```

**Implementation:**

1. Track drag start position and time
2. Calculate velocity from delta/time on drag end
3. Use requestAnimationFrame for inertia animation
4. Apply friction each frame until velocity below threshold
5. Clamp value to 0-1 range

**Event Handling:**

- Mouse: mousedown, mousemove, mouseup, mouseleave
- Touch: touchstart, touchmove, touchend
- Use non-passive listeners for preventDefault

---

## Phase 6: GridButton Component

### 6.1 Create `src/components/GridButton.tsx`

**Purpose:** Individual grid cell with complex visual state.

**Props:**

```typescript
interface GridButtonProps {
  active: boolean;
  isPlayhead: boolean;
  rowColor: string; // Channel color (hex)
  isCNote?: boolean; // Highlight C notes
  dimmed?: boolean; // Meta mode dimming
  glowIntensity?: number; // 0-1 glow strength
  isLoopBoundary?: boolean; // Start/end of loop
  isLoopBoundaryPulsing?: boolean; // Pulsate when Alt held
  isBeatMarker?: boolean; // Every 4th column
  isInLoop?: boolean; // Inside loop region
  isPendingLoopStart?: boolean; // First Alt-click marker
  isNoteStart?: boolean; // Start of a note
  isNoteContinuation?: boolean; // Middle of a note
  isNoteCurrentlyPlaying?: boolean; // Playhead within note
  isOffScreenIndicator?: boolean; // Off-screen note marker
  isOffScreenPlaying?: boolean; // Off-screen note playing
  onToggle: () => void;
  onDragEnter: () => void;
}
```

**Visual State Priority (descending):**

1. Note start + playing: White (#ffffff)
2. Note continuation + playing: Channel color + 20% white, 70% opacity
3. Off-screen indicator: 20-50% opacity based on playing state
4. Note start (not playing): Full channel color
5. Note continuation (not playing): 50% opacity channel color
6. Pending loop start: 40% white
7. Playhead: 30% white
8. Loop boundary: 20% white
9. Beat marker (in loop): 15% white
10. In loop (other): 10% white
11. C note bonus: +10% to above
12. Default: Dark gray (rgba(30, 30, 30, 0.9))

**Glow System:**

- Active notes: 5px glow with channel color
- Playing notes: 8-15px expanded glow
- Continuations: Reduced glow (50%)

**Pulsating Animation:**

- Global @keyframes injection on module load
- Synced animation-delay based on page load time
- 800ms cycle, 0.3-1 opacity range

---

## Phase 7: Main Grid Component

### 7.1 Create `src/components/Grid.tsx`

**Purpose:** Main grid UI, input handling, and display logic.

**Constants:**

```typescript
const TOTAL_ROWS = 128;
const TOTAL_COLS = 64;
const VISIBLE_ROWS = 8;
const VISIBLE_COLS = 16;
```

**State:**

```typescript
// Scroll position per channel (persists when switching)
rowOffsets: number[]           // [8], normalized 0-1
colOffset: number              // Single value, shared

// Modifier keys
shiftPressed: boolean
altPressed: boolean
metaPressed: boolean

// Loop selection
loopSelectionStart: number | null

// Keyboard note entry
heldNote: { row: number; col: number; key: string } | null
```

**Refs:**

```typescript
dragMode: boolean | null; // null=not dragging, true=adding, false=removing
visitedCells: Set<string>; // Prevent re-processing during drag
loopDragStart: number | null; // Loop drag origin
```

**Channel Colors:**

```typescript
const CHANNEL_COLORS = [
  "#ff3366", // Channel 0: Hot pink
  "#ff6633", // Channel 1: Orange
  "#ffcc00", // Channel 2: Yellow
  "#66ff33", // Channel 3: Lime
  "#33ffcc", // Channel 4: Cyan
  "#3366ff", // Channel 5: Blue
  "#9933ff", // Channel 6: Purple
  "#ff33cc", // Channel 7: Magenta
];
```

**Initial Row Offsets (per channel):**

- Channels 0-3 (drums): Start at MIDI note 36 (kick drum range)
- Channels 4-7 (melodic): Start at MIDI note 60 (middle C)

**Grid Rendering:**

1. Calculate `startRow` and `startCol` from offsets
2. Invert row display (high notes at top)
3. For each visible cell:
   - Calculate actual row/col in pattern
   - Determine if note start, continuation, or empty
   - Calculate if currently playing (playhead within note + loop boundaries)
   - Pass appropriate props to GridButton

**Input Handlers:**

_Normal Click:_

- Toggle note at position (length 1)
- Set dragMode based on new state

_Shift+Click:_

- Find first note to the left on same row
- Extend that note to click position
- If no note found, toggle normally

_Drag:_

- Continue adding/removing based on dragMode
- Track visited cells to prevent flickering

_Shift+Drag:_

- Extend notes or create new ones per row

_Alt+Click (Loop Selection):_

- First click: Set loopSelectionStart, create 1-column loop
- Subsequent clicks: Set loop from start to click (auto-corrects order)

_Alt+Drag:_

- Real-time loop boundary adjustment

**Keyboard Mapping:**

```typescript
const keyMap = {
  // Numbers 1-8 → Row offset 4, cols 0-7
  '1': {row: 4, col: 0}, '2': {row: 4, col: 1}, ...
  // Q-I → Row offset 5, cols 0-7
  'q': {row: 5, col: 0}, 'w': {row: 5, col: 1}, ...
  // A-K → Row offset 6, cols 0-7
  'a': {row: 6, col: 0}, 's': {row: 6, col: 1}, ...
  // Z-, → Row offset 7, cols 0-7
  'z': {row: 7, col: 0}, 'x': {row: 7, col: 1}, ...
};
```

**Keyboard Note Entry:**

1. On keydown: Store heldNote {row, col, key}
2. On second keydown (same row): Set note from first to second col
3. On keyup (no second key): Toggle single note

**Special Keys:**

- Space: Toggle play/stop
- Backspace: Reset playhead

**Meta Mode (Pattern Selector Overlay):**

- When metaPressed, grid shows channel/pattern selector
- 8 columns × 8 rows visible (channels × patterns)
- Color-coded by channel
- Intensity shows state (selected/queued/has notes/empty)
- Click to switch channel and pattern

**Off-Screen Note Indicators:**

- Edge cells show tinted markers for notes outside viewport
- Check above/below/left/right of visible area
- Track if any off-screen note is currently playing

---

## Phase 8: App Component

### 8.1 Create `src/App.tsx`

**Purpose:** Root component, state orchestration, layout.

**Structure:**

```tsx
<App>
  <Container>
    <Transport {...} />
    <Grid {...} />
  </Container>
</App>
```

**Integration:**

1. Initialize useSequencer hook
2. Initialize useMidi hook
3. Connect MIDI playNote to sequencer onPlayNote callback
4. Pass all state and handlers to child components

**Layout Styling:**

- Full viewport height
- Gradient background (#0a0a0a to #1a0a1a)
- Centered content
- Dark theme throughout

---

## Phase 9: Advanced Features

### 9.1 Pattern Queuing

- When playing, pattern changes are queued
- Pattern switches at loop start boundary
- Visual feedback: Queued patterns pulse
- Click queued pattern again to cancel queue

### 9.2 Note Length Visualization

- Note start: Full brightness
- Note continuation: 50% brightness
- When playing: Note start white, continuation brightened

### 9.3 Off-Screen Indicators

- Edge cells show markers for notes outside view
- Brighter when note is currently playing
- Shows grid styling underneath (transparent overlay)

### 9.4 Synchronized Animations

- All pulsing animations share same keyframes
- Animation delay calculated from page load time
- Ensures loop boundaries pulse in sync

---

## Phase 10: Styling Constants

### 10.1 Colors

```typescript
// Brightness levels for grid styling
const LOOP_BOUNDARY_BRIGHTNESS = 0.2; // 20%
const BEAT_MARKER_BRIGHTNESS = 0.15; // 15%
const IN_LOOP_BRIGHTNESS = 0.1; // 10%
const C_NOTE_BONUS = 0.1; // +10%
const PLAYHEAD_BRIGHTNESS = 0.3; // 30%

// Note states
const NOTE_CONTINUATION_OPACITY = 0.5;
const OFF_SCREEN_OPACITY = 0.2;
const OFF_SCREEN_PLAYING_OPACITY = 0.5;
```

### 10.2 Dimensions

```typescript
const BUTTON_SIZE = 40;
const BUTTON_MARGIN = 2;
const BUTTON_TOTAL = 44; // size + margin*2
const STRIP_THICKNESS = 24;
```

---

## Phase 11: Error Handling & Edge Cases

### 11.1 MIDI Errors

- Handle WebMIDI not supported
- Handle permission denied
- Handle device disconnection during playback
- Clear active notes on error

### 11.2 Grid Edge Cases

- Clamp scroll positions to valid range
- Handle notes at pattern boundaries
- Handle loop length of 1 (single column)
- Handle note extending beyond pattern length

### 11.3 Timing Edge Cases

- Handle BPM changes during playback
- Handle tab visibility (pause/resume)
- Prevent stuck notes on stop

---

## Phase 12: Performance Optimization

### 12.1 React Optimizations

- Memoize GridButton with React.memo
- Use useCallback for all handlers
- Use useMemo for expensive calculations
- Avoid creating objects in render

### 12.2 Render Optimization

- Only render visible grid cells (8×16)
- Virtualize pattern selector if needed
- Debounce scroll updates if necessary

### 12.3 Animation Performance

- Use CSS animations over JS where possible
- Use transform/opacity for animations
- Avoid layout thrashing

---

## File Structure Summary

```
src/
├── main.tsx                 # Entry point
├── App.tsx                  # Root component
├── types/
│   └── grid.ts              # Type definitions
├── hooks/
│   ├── useMidi.ts           # MIDI integration
│   └── useSequencer.ts      # Sequencer logic
└── components/
    ├── Transport.tsx        # Playback controls
    ├── TouchStrip.tsx       # Scrollable strip
    ├── Grid.tsx             # Main grid UI
    └── GridButton.tsx       # Grid cell
```

---

## Testing Checklist

### Core Functionality

- [ ] Notes toggle on/off with click
- [ ] Notes play when triggered by playhead
- [ ] Loop boundaries respected
- [ ] Pattern switching works (immediate when stopped)
- [ ] Pattern queuing works (when playing)
- [ ] BPM changes affect timing
- [ ] MIDI output selection works

### Interaction

- [ ] Drag to paint notes works
- [ ] Shift+click extends notes
- [ ] Shift+drag creates/extends notes
- [ ] Alt+click sets loop start
- [ ] Alt+click again sets loop end
- [ ] Alt+drag adjusts loop
- [ ] Keyboard note entry works
- [ ] Two-key keyboard note length works
- [ ] Space toggles play/stop
- [ ] Backspace resets playhead

### Visual

- [ ] Playhead moves correctly
- [ ] Notes light up when played
- [ ] Loop boundaries highlighted
- [ ] Beat markers visible
- [ ] C notes highlighted
- [ ] Off-screen indicators show
- [ ] Pattern selector overlay works (Meta)
- [ ] Queued patterns pulse

### Edge Cases

- [ ] Loop length of 1 works
- [ ] Notes at pattern edges work
- [ ] Fast tempo doesn't skip notes
- [ ] Channel switching preserves scroll
- [ ] Pattern switching preserves notes

---

## Implementation Order Summary

1. **Project setup** - Vite, TypeScript, dependencies
2. **Type definitions** - Core interfaces and constants
3. **useMidi hook** - WebMIDI integration
4. **useSequencer hook** - State and basic playback
5. **Transport component** - Play/stop, BPM
6. **GridButton component** - Cell styling
7. **TouchStrip component** - Scrolling
8. **Grid component** - Layout and basic click
9. **Keyboard input** - Grid shortcuts
10. **Note length** - Shift+click, continuation display
11. **Loop selection** - Alt+click/drag
12. **Pattern selector** - Meta mode overlay
13. **Pattern queuing** - Queue system
14. **Off-screen indicators** - Edge markers
15. **Polish** - Animations, optimization
