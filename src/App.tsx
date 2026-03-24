import { useCallback, useEffect, useRef, useState } from "react";
import { css, Global } from "@emotion/react";
import { Box, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Grid } from "./components/Grid";
import { Transport } from "./components/Transport";
import { WasmEngine } from "./engine/WasmEngine";
import { TeensyEngine } from "./engine/TeensyEngine";
import type { Engine } from "./engine/types";
import { useMidi } from "./hooks/useMidi";
import { useRenderVersion } from "./store/renderStore";
import * as actions from "./actions";
import type { StepTriggerExtras } from "./actions";
import { TICKS_PER_QUARTER } from "./components/Grid/Grid.config";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
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
    font-family:
      "Inter",
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
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
  // Engine — null until loaded, non-null gates rendering.
  // Supports WasmEngine (browser-only) or TeensyEngine (USB serial).
  const engineRef = useRef<Engine | null>(null);
  const [wasmEngine, setWasmEngine] = useState<Engine | null>(null);
  const [teensyConnected, setTeensyConnected] = useState(false);

  useEffect(() => {
    console.log("[startup] Loading WASM engine...");
    const engine = new WasmEngine();
    engine
      .load()
      .then(() => {
        // Full init (resets UI state, generates chord shapes, sets default loops/patterns)
        engine.fullInit();

        // Set channel types: channels 0-3 melodic, 4-5 drum
        engine.writeChannelTypes([0, 0, 0, 0, 1, 1]);

        // Set initial zoom (1/16 = 120 ticks per col)
        engine.setZoom(120);

        // Set initial BPM in WASM
        engine.setBpm(120);

        // Compute initial row offsets to position C4 at bottom for melodic channels
        // Scale mapping is built by engine_core_init() in WASM (default: C Major)
        {
          const scaleCount = engine.getScaleCount();
          const scaleZeroIndex = engine.getScaleZeroIndex();
          const visibleRows = engine.getVisibleRows();
          const melodicMaxRowOffset = Math.max(0, scaleCount - visibleRows);
          const melodicOffset =
            melodicMaxRowOffset > 0
              ? 1 - scaleZeroIndex / melodicMaxRowOffset
              : 0.5;
          const drumMaxRowOffset = Math.max(0, 128 - visibleRows);
          const drumOffset =
            drumMaxRowOffset > 0 ? 1 - 36 / drumMaxRowOffset : 0.5;
          for (let ch = 0; ch < 6; ch++) {
            engine.setRowOffset(ch, ch >= 4 ? drumOffset : melodicOffset);
          }
        }

        engineRef.current = engine;
        setWasmEngine(engine);
        actions.setEngine(engine);
        console.log(
          "[startup] WASM engine v" +
            engine.getVersion() +
            " ready, isEnabled=" +
            isEnabled,
        );
      })
      .catch((err) => {
        console.warn("WASM engine not available:", err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to render version for transport state re-renders
  useRenderVersion();

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
    (
      channel: number,
      midiNote: number,
      _tick: number,
      noteLengthTicks: number,
      velocity: number,
      extras?: StepTriggerExtras,
    ) => {
      const note = midiNote;
      const midiChannel = channel + 1;

      // Scrub preview: play immediately, schedule quick note-off
      if (noteLengthTicks <= 1) {
        playNote(note, velocity, midiChannel);
        const id = setTimeout(() => {
          pendingTimeouts.current.delete(id);
          stopNote(note, midiChannel);
        }, 80);
        pendingTimeouts.current.add(id);
        return;
      }

      const tickDurationMs = 60000 / (bpmRef.current * TICKS_PER_QUARTER);
      const stepDurationMs = tickDurationMs * (TICKS_PER_QUARTER / 4);

      const maxOffsetPercent = 70;
      const lookaheadMs = (maxOffsetPercent / 100) * stepDurationMs;
      const timingOffsetMs = extras?.timingOffsetPercent
        ? (extras.timingOffsetPercent / 100) * stepDurationMs
        : 0;
      const noteDelayMs = lookaheadMs + timingOffsetMs;

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
        scheduleNote(() => playNote(note, velocity, midiChannel), noteDelayMs);
        for (let f = 0; f < flamCount; f++) {
          const flamTime = noteDelayMs + (f + 1) * thirtySecondMs;
          scheduleNote(
            () => playNote(note, flamVelocity, midiChannel),
            flamTime,
          );
        }
      } else {
        scheduleNote(() => playNote(note, velocity, midiChannel), noteDelayMs);
      }
    },
    [playNote, stopNote],
  );

  const handleNoteOff = useCallback(
    (channel: number, midiNote: number) => {
      stopNote(midiNote, channel + 1);
    },
    [stopNote],
  );

  // Read transport state from WASM
  const isPlaying = wasmEngine ? wasmEngine.getIsPlaying() : false;
  const isExternalPlayback = wasmEngine
    ? wasmEngine.getIsExternalPlayback()
    : false;
  const bpm = wasmEngine ? wasmEngine.getBpm() : 120;
  const [swing, setSwingLocal] = useState(50);

  // Keep bpmRef in sync with actual BPM
  bpmRef.current = bpm;

  const handlePlayNote = useCallback(
    (note: number, channel: number, lengthTicks?: number) => {
      playNote(note, 100, channel + 1);
      const ticks = lengthTicks ?? TICKS_PER_QUARTER / 4;
      const tickDurationMs = 60000 / (bpmRef.current * TICKS_PER_QUARTER);
      const duration = Math.max(50, ticks * tickDurationMs - 10);
      setTimeout(() => stopNote(note, channel + 1), duration);
    },
    [playNote, stopNote],
  );

  // Wire up step trigger and note-off callbacks
  useEffect(() => {
    const engine = engineRef.current;
    console.log("[startup] Wiring callbacks: engine=" + !!engine);
    if (engine) {
      engine.onStepTrigger = handleStepTrigger;
      engine.onNoteOff = handleNoteOff;
      engine.onPlayPreviewNote = (
        channel: number,
        row: number,
        lengthTicks: number,
      ) => {
        const isDrum = engine.getChannelType(channel) === 1;
        const midiNote = isDrum
          ? Math.max(0, Math.min(127, row))
          : engine.noteToMidi(row);
        if (midiNote >= 0) {
          handlePlayNote(
            midiNote,
            channel,
            lengthTicks > 0 ? lengthTicks : undefined,
          );
        }
      };
    }
    return () => {
      if (engine) {
        engine.onStepTrigger = null;
        engine.onNoteOff = null;
        engine.onPlayPreviewNote = null;
      }
    };
  }, [handleStepTrigger, handleNoteOff, handlePlayNote, wasmEngine]);

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

  const handlePlay = useCallback(() => {
    actions.play();
  }, []);

  const handleStop = useCallback(() => {
    for (const id of pendingTimeouts.current) {
      clearTimeout(id);
    }
    pendingTimeouts.current.clear();
    actions.stop();
    stopAllNotes();
  }, [stopAllNotes]);

  const handleReset = useCallback(() => {
    for (const id of pendingTimeouts.current) {
      clearTimeout(id);
    }
    pendingTimeouts.current.clear();
    actions.resetPosition();
    stopAllNotes();
  }, [stopAllNotes]);

  const handleClear = useCallback(() => {
    actions.clearPattern();
  }, []);

  const handleSetBpm = useCallback((newBpm: number) => {
    actions.setBpm(newBpm);
  }, []);

  const handleSetSwing = useCallback((newSwing: number) => {
    setSwingLocal(newSwing);
    actions.setSwing(newSwing);
  }, []);

  const handleConnectTeensy = useCallback(async () => {
    if (teensyConnected) {
      // Disconnect and switch back to WASM
      const current = engineRef.current;
      if (current?.disconnect) current.disconnect();
      // Reload a fresh WASM engine
      const fresh = new WasmEngine();
      await fresh.load();
      fresh.fullInit();
      fresh.writeChannelTypes([0, 0, 0, 0, 1, 1]);
      fresh.setZoom(120);
      fresh.setBpm(bpm);
      engineRef.current = fresh;
      setWasmEngine(fresh);
      actions.setEngine(fresh);
      setTeensyConnected(false);
      return;
    }

    try {
      const teensy = new TeensyEngine();
      teensy.onConnectionChange = (connected) => {
        setTeensyConnected(connected);
        if (!connected) {
          // Teensy disconnected — fall back to its internal WASM engine
          // (it's still usable, just not connected to hardware)
        }
      };
      await teensy.load();
      teensy.fullInit();
      teensy.writeChannelTypes([0, 0, 0, 0, 1, 1]);
      teensy.setZoom(120);
      teensy.setBpm(bpm);

      // Compute initial row offsets
      {
        const sc = teensy.getScaleCount();
        const szi = teensy.getScaleZeroIndex();
        const vr = teensy.getVisibleRows();
        const melodicMax = Math.max(0, sc - vr);
        const melodicOff = melodicMax > 0 ? 1 - szi / melodicMax : 0.5;
        const drumMax = Math.max(0, 128 - vr);
        const drumOff = drumMax > 0 ? 1 - 36 / drumMax : 0.5;
        for (let ch = 0; ch < 6; ch++) {
          teensy.setRowOffset(ch, ch >= 4 ? drumOff : melodicOff);
        }
      }

      await teensy.connect(); // Opens WebSerial port picker

      engineRef.current = teensy;
      setWasmEngine(teensy);
      actions.setEngine(teensy);
      setTeensyConnected(true);
    } catch (e) {
      console.warn("Teensy connection failed:", e);
    }
  }, [teensyConnected, bpm]);

  // Don't render anything until both WASM and MIDI are ready
  if (!wasmEngine || !isEnabled) {
    console.log(
      "[startup] Gated: wasmEngine=" + !!wasmEngine + " isEnabled=" + isEnabled,
    );
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Global styles={globalStyles} />
        <Box css={appContainerStyles}>
          <Box component="h1" css={titleStyles}>
            ARPEGGINATOR
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  // console.log(
  //   "[startup] Full render: wasmEngine=" +
  //     !!wasmEngine +
  //     " isEnabled=" +
  //     isEnabled,
  // );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Global styles={globalStyles} />
      <Box css={appContainerStyles}>
        <Box component="h1" css={titleStyles}>
          ARPEGGINATOR
        </Box>
        <Transport
          isPlaying={isPlaying}
          isExternalPlayback={isExternalPlayback}
          bpm={bpm}
          swing={swing}
          onPlay={handlePlay}
          onStop={handleStop}
          onReset={handleReset}
          onClear={handleClear}
          onBpmChange={handleSetBpm}
          onSwingChange={handleSetSwing}
          midiOutputs={outputs}
          midiInputs={inputs}
          selectedOutput={selectedOutput}
          selectedInput={selectedInput}
          onOutputChange={setSelectedOutput}
          onInputChange={setSelectedInput}
          midiEnabled={isEnabled}
        />
        {"serial" in navigator && (
          <Box sx={{ display: "flex", justifyContent: "center", mb: 1 }}>
            <Box
              component="button"
              onClick={handleConnectTeensy}
              sx={{
                background: teensyConnected ? "#1a3a1a" : "#1a1a2a",
                border: `1px solid ${teensyConnected ? "#4a8a4a" : "#3a3a5a"}`,
                color: teensyConnected ? "#6c6" : "#888",
                borderRadius: "4px",
                px: 2,
                py: 0.5,
                cursor: "pointer",
                fontSize: "12px",
                letterSpacing: "1px",
                "&:hover": {
                  borderColor: teensyConnected ? "#6c6" : "#66f",
                },
              }}
            >
              {teensyConnected ? "TEENSY CONNECTED" : "CONNECT TEENSY"}
            </Box>
          </Box>
        )}
        <Grid wasmEngine={wasmEngine} />
      </Box>
    </ThemeProvider>
  );
}

export default App;
