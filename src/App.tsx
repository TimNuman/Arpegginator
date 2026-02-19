import { useCallback, useEffect, useRef, useState } from 'react';
import { css, Global } from '@emotion/react';
import { Box, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Grid } from './components/Grid';
import { Transport } from './components/Transport';
import { EngineToggle } from './components/EngineToggle';
import { WasmEngine } from './engine/WasmEngine';
import { useMidi } from './hooks/useMidi';
import { useSequencerStore } from './store/sequencerStore';
import * as actions from './actions';
import type { StepTriggerExtras } from './actions';
import { TICKS_PER_QUARTER } from './types/event';


const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const globalStyles = css`
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 0;
    background: linear-gradient(180deg, #0a0a0a 0%, #1a0a1a 100%);
    min-height: 100vh;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }
`;

const appContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px 20px;
`;

const titleStyles = css`
  color: #fff;
  font-size: 32px;
  font-weight: 300;
  letter-spacing: 8px;
  margin-bottom: 30px;
  text-transform: uppercase;
  background: linear-gradient(90deg, #ff3366, #66ffcc, #3366ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
`;

function App() {
  // WASM engine
  const wasmEngineRef = useRef<WasmEngine | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmVersion, setWasmVersion] = useState<number | undefined>(undefined);

  useEffect(() => {
    const engine = new WasmEngine();
    engine.load().then(() => {
      wasmEngineRef.current = engine;
      setWasmReady(true);
      setWasmVersion(engine.getVersion());
      console.log('WASM test: 5 + 7 =', engine.add(5, 7));
    }).catch((err) => {
      console.warn('WASM engine not available:', err);
    });
  }, []);

  // Use a ref for BPM so handleStepTrigger can access current value without re-creating
  const bpmRef = useRef(120);
  // Track pending note timeouts so we can cancel them on stop
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Refs for transport callbacks to avoid circular dependencies
  const playExternalRef = useRef<() => void>(() => {});
  const stopExternalRef = useRef<() => void>(() => {});
  const externalTickRef = useRef<() => void>(() => {});
  const setBpmRef = useRef<(bpm: number) => void>(() => {});

  const {
    isEnabled,
    outputs,
    inputs,
    selectedOutput,
    selectedInput,
    setSelectedOutput,
    setSelectedInput,
    playNote,
    stopNote,
    stopAllNotes,
  } = useMidi({
    onStart: () => playExternalRef.current(),
    onStop: () => stopExternalRef.current(),
    onContinue: () => playExternalRef.current(),
    onClock: () => externalTickRef.current(),
    onTempoChange: (bpm) => setBpmRef.current(bpm),
  });

  const handleStepTrigger = useCallback(
    (channel: number, midiNote: number, _tick: number, _noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => {
      const note = midiNote; // Already MIDI, modulation applied in playbackActions
      const midiChannel = channel + 1;
      // Tick-based timing: ms per tick = 60000 / (bpm * PPQ)
      const tickDurationMs = 60000 / (bpmRef.current * TICKS_PER_QUARTER);
      // Step duration for timing offset calculations (one 16th note = PPQ/4 ticks)
      const stepDurationMs = tickDurationMs * (TICKS_PER_QUARTER / 4);

      // Timing offset: convert % of step to ms.
      // To support negative offsets (early notes) we add a lookahead so all
      // scheduled times stay positive for setTimeout.
      const maxOffsetPercent = 20; // matches TIMING_LEVELS max
      const lookaheadMs = (maxOffsetPercent / 100) * stepDurationMs;
      const timingOffsetMs = extras?.timingOffsetPercent
        ? (extras.timingOffsetPercent / 100) * stepDurationMs
        : 0;
      // Delay = lookahead + offset. 0% → plays at lookahead, -20% → plays at 0, +20% → plays at 2×lookahead
      const noteDelayMs = lookaheadMs + timingOffsetMs;

      // Flam: main note on the beat, grace note(s) a 32nd note later
      const flamCount = extras?.flamCount ?? 0;
      const thirtySecondMs = stepDurationMs / 2;

      const scheduleNote = (fn: () => void, delayMs: number) => {
        const id = setTimeout(() => {
          pendingTimeouts.current.delete(id);
          fn();
        }, delayMs);
        pendingTimeouts.current.add(id);
      };

      if (flamCount > 0) {
        const flamVelocity = Math.round(velocity * 0.6);
        // Main note plays at its delayed time
        scheduleNote(() => playNote(note, velocity, midiChannel), noteDelayMs);
        // Grace note(s) follow a 32nd note later — retrigger cuts off main note naturally
        for (let f = 0; f < flamCount; f++) {
          const flamTime = noteDelayMs + (f + 1) * thirtySecondMs;
          scheduleNote(() => playNote(note, flamVelocity, midiChannel), flamTime);
        }
        // Note-off is handled by the tick-based noteOffCallback
      } else {
        scheduleNote(() => playNote(note, velocity, midiChannel), noteDelayMs);
        // Note-off is handled by the tick-based noteOffCallback
      }
    },
    [playNote]
  );

  const handleNoteOff = useCallback(
    (channel: number, midiNote: number) => {
      stopNote(midiNote, channel + 1);
    },
    [stopNote]
  );

  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const isExternalPlayback = useSequencerStore((s) => s.isExternalPlayback);
  const bpm = useSequencerStore((s) => s.bpm);

  // Keep bpmRef in sync with actual BPM
  bpmRef.current = bpm;

  // Wire up step trigger and note-off callbacks
  useEffect(() => {
    actions.setStepTriggerCallback(handleStepTrigger);
    actions.setNoteOffCallback(handleNoteOff);
    return () => {
      actions.setStepTriggerCallback(null);
      actions.setNoteOffCallback(null);
    };
  }, [handleStepTrigger, handleNoteOff]);

  // Keep transport refs in sync for MIDI sync callbacks
  playExternalRef.current = actions.playExternal;
  stopExternalRef.current = () => {
    for (const id of pendingTimeouts.current) {
      clearTimeout(id);
    }
    pendingTimeouts.current.clear();
    actions.stopExternal();
    stopAllNotes();
  };
  externalTickRef.current = actions.externalTick;
  setBpmRef.current = actions.setBpm;

  const handlePlayNote = useCallback(
    (note: number, channel: number, lengthTicks?: number) => {
      // Use channel + 1 for MIDI channel (1-8)
      playNote(note, 100, channel + 1);
      // Calculate duration from tick length (default to 1 sixteenth note = PPQ/4 ticks)
      const ticks = lengthTicks ?? (TICKS_PER_QUARTER / 4);
      const tickDurationMs = 60000 / (bpm * TICKS_PER_QUARTER);
      const duration = Math.max(50, ticks * tickDurationMs - 10); // Subtract 10ms for note separation
      setTimeout(() => stopNote(note, channel + 1), duration);
    },
    [playNote, stopNote, bpm]
  );

  const handlePlay = useCallback(() => {
    actions.play();
  }, []);

  const handleStop = useCallback(() => {
    // Cancel all pending scheduled notes
    for (const id of pendingTimeouts.current) {
      clearTimeout(id);
    }
    pendingTimeouts.current.clear();
    actions.stop();
    stopAllNotes();
  }, [stopAllNotes]);

  const handleClear = useCallback(() => {
    actions.clearPattern();
  }, []);

  const handleSetBpm = useCallback((newBpm: number) => {
    actions.setBpm(newBpm);
  }, []);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Global styles={globalStyles} />
      <Box css={appContainerStyles}>
        <Box component="h1" css={titleStyles}>
          ARP3
        </Box>
        <Transport
          isPlaying={isPlaying}
          isExternalPlayback={isExternalPlayback}
          bpm={bpm}
          onPlay={handlePlay}
          onStop={handleStop}
          onClear={handleClear}
          onBpmChange={handleSetBpm}
          midiOutputs={outputs}
          midiInputs={inputs}
          selectedOutput={selectedOutput}
          selectedInput={selectedInput}
          onOutputChange={setSelectedOutput}
          onInputChange={setSelectedInput}
          midiEnabled={isEnabled}
        />
        <EngineToggle wasmReady={wasmReady} wasmVersion={wasmVersion} />
        <Grid onPlayNote={handlePlayNote} />
      </Box>
    </ThemeProvider>
  );
}

export default App;
