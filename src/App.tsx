import { useCallback, useEffect, useRef } from 'react';
import { css, Global } from '@emotion/react';
import { Box, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Grid } from './components/Grid';
import { Transport } from './components/Transport';
import { useMidi } from './hooks/useMidi';
import { useSequencerStore } from './store/sequencerStore';
import * as actions from './actions';

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
    (channel: number, row: number, _step: number, noteLength: number, velocity: number) => {
      const note = getRowNote(row);
      // Use channel + 1 for MIDI channel (1-8)
      playNote(note, velocity, channel + 1);
      // Calculate note duration based on BPM and note length
      // One step = one 16th note = (60 / bpm / 4) seconds
      const stepDurationMs = (60 / bpmRef.current) * 1000 / 4;
      // Shorten the last step by 10% to create a small gap between consecutive notes
      const noteDurationMs = stepDurationMs * (noteLength - 0.1);
      setTimeout(() => stopNote(note, channel + 1), noteDurationMs);
    },
    [playNote, stopNote]
  );

  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const isExternalPlayback = useSequencerStore((s) => s.isExternalPlayback);
  const bpm = useSequencerStore((s) => s.bpm);

  // Keep bpmRef in sync with actual BPM
  bpmRef.current = bpm;

  // Wire up step trigger callback
  useEffect(() => {
    actions.setStepTriggerCallback(handleStepTrigger);
    return () => {
      actions.setStepTriggerCallback(null);
    };
  }, [handleStepTrigger]);

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
