import { useCallback, useEffect, useRef } from 'react';
import { css, Global } from '@emotion/react';
import { Box, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Grid } from './components/Grid';
import { Transport } from './components/Transport';
import { useMidi } from './hooks/useMidi';
import { useSequencerStore } from './store/sequencerStore';
import * as actions from './actions';
import type { StepTriggerExtras } from './actions';

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

// Row number equals MIDI note number directly (0-127)
const getRowNote = (row: number): number => {
  return row;
};

function App() {
  // Use a ref for BPM so handleStepTrigger can access current value without re-creating
  const bpmRef = useRef(120);

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
    (channel: number, row: number, _step: number, _noteLength: number, velocity: number, extras?: StepTriggerExtras) => {
      const note = getRowNote(row) + (extras?.modulateHalfSteps ?? 0);
      const midiChannel = channel + 1;
      const stepDurationMs = (60 / bpmRef.current) * 1000 / 4;

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

      if (flamCount > 0) {
        const flamVelocity = Math.round(velocity * 0.6);
        // Main note plays at its delayed time
        setTimeout(() => {
          playNote(note, velocity, midiChannel);
        }, noteDelayMs);
        // Grace note(s) follow a 32nd note later — retrigger cuts off main note naturally
        for (let f = 0; f < flamCount; f++) {
          const flamTime = noteDelayMs + (f + 1) * thirtySecondMs;
          setTimeout(() => {
            playNote(note, flamVelocity, midiChannel);
          }, flamTime);
        }
        // Note-off is handled by the tick-based noteOffCallback
      } else {
        setTimeout(() => {
          playNote(note, velocity, midiChannel);
        }, noteDelayMs);
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
    actions.stopExternal();
    stopAllNotes();
  };
  externalTickRef.current = actions.externalTick;
  setBpmRef.current = actions.setBpm;

  const handlePlayNote = useCallback(
    (note: number, channel: number, steps: number = 1) => {
      // Use channel + 1 for MIDI channel (1-8)
      playNote(note, 100, channel + 1);
      // Calculate duration based on BPM and number of steps
      // At 120 BPM, one beat = 500ms, one step (16th note) = 125ms
      const msPerStep = (60000 / bpm) / 4;
      const duration = Math.max(50, msPerStep * steps - 10); // Subtract 10ms for note separation
      setTimeout(() => stopNote(note, channel + 1), duration);
    },
    [playNote, stopNote, bpm]
  );

  const handlePlay = useCallback(() => {
    actions.play();
  }, []);

  const handleStop = useCallback(() => {
    actions.stop();
    stopAllNotes();
  }, [stopAllNotes]);

  const handleClear = useCallback(() => {
    actions.clearGrid();
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
        <Grid onPlayNote={handlePlayNote} />
      </Box>
    </ThemeProvider>
  );
}

export default App;
