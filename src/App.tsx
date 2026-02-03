import { useCallback, useRef } from 'react';
import { css, Global } from '@emotion/react';
import { Box, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { Grid } from './components/Grid';
import { Transport } from './components/Transport';
import { useMidi } from './hooks/useMidi';
import { useSequencer, CHANNEL_COLORS } from './hooks/useSequencer';

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
    (channel: number, row: number, _step: number, noteLength: number) => {
      const note = getRowNote(row);
      // Use channel + 1 for MIDI channel (1-8)
      playNote(note, 100, channel + 1);
      // Calculate note duration based on BPM and note length
      // One step = one 16th note = (60 / bpm / 4) seconds
      const stepDurationMs = (60 / bpmRef.current) * 1000 / 4;
      // Shorten the last step by 10% to create a small gap between consecutive notes
      const noteDurationMs = stepDurationMs * (noteLength - 0.1);
      setTimeout(() => stopNote(note, channel + 1), noteDurationMs);
    },
    [playNote, stopNote]
  );

  const {
    gridState,
    currentChannel,
    setCurrentChannel,
    currentPattern,
    currentPatterns,
    setChannelPattern,
    queuedPatterns,
    channelsHaveNotes,
    allPatternsHaveNotes,
    channelsPlayingNow,
    isPulseBeat,
    isPlaying,
    bpm,
    currentStep,
    toggleCell,
    setNote,
    clearGrid,
    play,
    stop,
    pause,
    resetPlayhead,
    setBpm,
    currentLoop,
    setPatternLoop,
    // External sync
    externalTick,
    playExternal,
    stopExternal,
  } = useSequencer({
    onStepTrigger: handleStepTrigger,
  });

  // Keep bpmRef in sync with actual BPM
  bpmRef.current = bpm;

  // Keep transport refs in sync for MIDI sync callbacks
  playExternalRef.current = playExternal;
  stopExternalRef.current = () => {
    stopExternal();
    stopAllNotes();
  };
  externalTickRef.current = externalTick;
  setBpmRef.current = setBpm; // Update BPM display from external clock

  const handlePlayNote = useCallback(
    (note: number, channel: number) => {
      // Use channel + 1 for MIDI channel (1-8)
      playNote(note, 100, channel + 1);
      setTimeout(() => stopNote(note, channel + 1), 100);
    },
    [playNote, stopNote]
  );

  const handleStop = useCallback(() => {
    stop();
    stopAllNotes();
  }, [stop, stopAllNotes]);

  const handlePause = useCallback(() => {
    pause();
    stopAllNotes();
  }, [pause, stopAllNotes]);

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      handlePause();
    } else {
      play();
    }
  }, [isPlaying, handlePause, play]);

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
          bpm={bpm}
          onPlay={play}
          onStop={handleStop}
          onClear={clearGrid}
          onBpmChange={setBpm}
          midiOutputs={outputs}
          midiInputs={inputs}
          selectedOutput={selectedOutput}
          selectedInput={selectedInput}
          onOutputChange={setSelectedOutput}
          onInputChange={setSelectedInput}
          midiEnabled={isEnabled}
        />
        <Grid
          gridState={gridState}
          currentStep={currentStep}
          onToggleCell={toggleCell}
          onSetNote={setNote}
          channelColor={CHANNEL_COLORS[currentChannel]}
          currentChannel={currentChannel}
          onChannelChange={setCurrentChannel}
          currentPattern={currentPattern}
          currentPatterns={currentPatterns}
          onPatternChange={setChannelPattern}
          queuedPatterns={queuedPatterns}
          channelsHaveNotes={channelsHaveNotes}
          onPlayNote={handlePlayNote}
          allPatternsHaveNotes={allPatternsHaveNotes}
          currentLoop={currentLoop}
          onSetPatternLoop={setPatternLoop}
          channelsPlayingNow={channelsPlayingNow}
          isPulseBeat={isPulseBeat}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onResetPlayhead={resetPlayhead}
        />
      </Box>
    </ThemeProvider>
  );
}

export default App;
