import { useCallback, useEffect, useRef, useState } from "react";
import type { Output } from "webmidi";
import { css, Global } from "@emotion/react";
import { bevelOut, chrome, pinstripes } from "./theme/chrome";
import { Box, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Grid } from "./components/Grid";
import { Transport } from "./components/Transport";
import { WasmEngine } from "./engine/WasmEngine";
import { TeensyEngine } from "./engine/TeensyEngine";
import type { Engine } from "./engine/types";
import { useMidi, STORAGE_KEY_BUILTIN_SOUND } from "./hooks/useMidi";
import { useFitScale } from "./hooks/useFitScale";
import { synth } from "./audio/WebAudioSynth";
import { SampleRecorder } from "./audio/SampleRecorder";
import { useRenderVersion } from "./store/renderStore";
import * as actions from "./actions";
import { TICKS_PER_QUARTER } from "./components/Grid/Grid.config";

/** Web-mic recorder for the drum sampler (engine ref wired once loaded). */
const recorder = new SampleRecorder(synth);

/** MUI inherits the case, so its widgets stop looking like 2015 on a 1992 box. */
const caseTheme = createTheme({
  palette: {
    mode: "light",
    background: { default: chrome.case, paper: chrome.case },
    text: { primary: chrome.ink, secondary: chrome.inkDim },
  },
  typography: { fontFamily: chrome.font },
  shape: { borderRadius: 2 },
});

const globalStyles = css`
  * {
    box-sizing: border-box;
  }

  html,
  body {
    overscroll-behavior: none;
  }

  body {
    margin: 0;
    padding: 0;
    /* The desktop the machine sits on, dithered the way 8-bit teal was */
    background-color: ${chrome.desktop};
    background-image: radial-gradient(${chrome.desktopDark} 0.5px, transparent 0.5px);
    background-size: 6px 6px;
    min-height: 100vh;
    min-height: 100dvh;
    font-family: ${chrome.font};
    color: ${chrome.ink};
    /* Mobile Safari: no double-tap zoom, tap flashes, or long-press callouts */
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  input,
  textarea {
    -webkit-user-select: text;
    user-select: text;
  }
`;

const appContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 40px 20px;
  /* Keep clear of the Dynamic Island / home indicator in landscape */
  padding-left: max(20px, env(safe-area-inset-left));
  padding-right: max(20px, env(safe-area-inset-right));
  padding-bottom: max(40px, env(safe-area-inset-bottom));

  @media (max-height: 520px) {
    padding: 8px;
    padding-left: max(8px, env(safe-area-inset-left));
    padding-right: max(8px, env(safe-area-inset-right));
    padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
`;

/** Fixed-size content that gets uniformly scaled down on small screens.
    Dressed as a desktop window: platinum case, hard bevel, drop shadow. */
const stageStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: fit-content;
  padding: 3px 3px 8px;
  background: ${chrome.case};
  ${bevelOut}
  box-shadow:
    inset 1px 1px 0 ${chrome.caseLight},
    inset -1px -1px 0 ${chrome.caseShadow},
    inset 2px 2px 0 ${chrome.caseHi},
    inset -2px -2px 0 ${chrome.caseMid},
    4px 4px 0 rgba(0, 0, 0, 0.28);
`;

/** Window title bar — pinstriped with a close box, matching the chrome the
    display itself draws, with the title knocked out of the stripes. */
const titleStyles = css`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  height: 22px;
  margin: 0 0 8px;
  padding: 0;
  ${pinstripes}
  border-bottom: 1px solid ${chrome.caseDark};

  &::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 3px;
    width: 15px;
    height: 15px;
    background: ${chrome.case};
    border: 1px solid ${chrome.caseDark};
    box-shadow:
      inset 0 0 0 2px ${chrome.case},
      inset 0 0 0 3px ${chrome.caseDark};
  }

  span {
    background: ${chrome.case};
    padding: 0 10px;
    font-family: ${chrome.font};
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${chrome.ink};
  }

  /* Short screens (landscape phone): drop the title to give the grid room */
  @media (max-height: 520px) {
    display: none;
  }
`;

const rotateHintStyles = css`
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(10, 10, 10, 0.96);
  color: rgba(255, 255, 255, 0.85);
  font-size: 18px;
  letter-spacing: 2px;
  text-transform: uppercase;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;

  @media (orientation: portrait) and (max-width: 520px) {
    display: flex;
  }
`;

function App() {
  // Engine — null until loaded, non-null gates rendering.
  // Supports WasmEngine (browser-only) or TeensyEngine (USB serial).
  const engineRef = useRef<Engine | null>(null);
  const [wasmEngine, setWasmEngine] = useState<Engine | null>(null);
  const [teensyConnected, setTeensyConnected] = useState(false);

  // Scale the fixed-size UI down to fit small viewports (landscape phones)
  const fitContainerRef = useRef<HTMLDivElement>(null);
  const fitStageRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(fitContainerRef, fitStageRef, wasmEngine !== null);

  const tryAutoConnectTeensy = useCallback(async (wasmEng: WasmEngine) => {
    try {
      if (!navigator.requestMIDIAccess) return;
      // Request MIDI access (may prompt user once for sysex permission)
      const access = await navigator.requestMIDIAccess({ sysex: true });
      // Check if Arp3 Sequencer is present
      const found = Array.from(access.outputs.values()).some((p) => p.name?.includes("Arp3"));
      if (!found) {
        console.log("[startup] No Teensy found, using WASM engine");
        return;
      }

      console.log("[startup] Arp3 Sequencer found, auto-connecting...");
      const teensy = new TeensyEngine(wasmEng);
      teensy.onConnectionChange = (connected) => {
        setTeensyConnected(connected);
      };
      await teensy.connect();
      engineRef.current = teensy;
      setWasmEngine(teensy);
      actions.setEngine(teensy);
      setTeensyConnected(true);
    } catch (e) {
      console.log("[startup] Teensy auto-connect failed, using WASM:", e);
    }
  }, []);

  useEffect(() => {
    console.log("[startup] Loading WASM engine...");
    const engine = new WasmEngine();
    engine
      .load()
      .then(() => {
        // Full init (resets UI state, generates chord shapes, sets default loops/patterns)
        engine.fullInit();

        // Channel types, zoom, BPM, and row offsets are all set by
        // engine_core_init() in Rust — no TS-side init needed.

        engineRef.current = engine;
        setWasmEngine(engine);
        actions.setEngine(engine);
        console.log("[startup] WASM engine v" + engine.getVersion() + " ready");

        // Auto-connect to Teensy if one is present
        tryAutoConnectTeensy(engine);
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
    sendControlChange,
  } = useMidi({
    onStart: () => playExternalRef.current(),
    onStop: () => stopExternalRef.current(),
    onContinue: () => playExternalRef.current(),
    onClock: () => externalTickRef.current(),
    onTempoChange: (bpm) => setBpmRef.current(bpm),
  });

  // Built-in Web Audio sounds (808 drums + piano) — used when no MIDI output
  // is selected. Default on, so devices without Web MIDI (e.g. iPad) make
  // sound out of the box.
  const [builtinSound, setBuiltinSound] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY_BUILTIN_SOUND) !== "0",
  );

  // iOS/Safari requires the AudioContext to be resumed from a user gesture —
  // and only some gestures qualify (touchend/click do; touchstart/pointerdown
  // may not). Listen to all of them, permanently: iOS can re-suspend the
  // context after interruptions (calls, app switches), so every gesture is a
  // chance to recover. All are cheap no-ops once audio is running.
  useEffect(() => {
    const unlock = () => synth.resume();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("touchend", unlock, { passive: true });
    window.addEventListener("click", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchend", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Route note events: MIDI hardware when an output is selected, otherwise
  // the built-in synth. Drum channels get the 808 kit, melodic ones piano.
  const playSound = useCallback(
    (midiNote: number, velocity: number, channel: number) => {
      if (selectedOutput) {
        playNote(midiNote, velocity, channel + 1);
      } else if (builtinSound) {
        const isDrum = engineRef.current?.getChannelType(channel) === 1;
        synth.noteOn(channel, midiNote, velocity, isDrum);
      }
    },
    [selectedOutput, builtinSound, playNote],
  );

  const stopSound = useCallback(
    (midiNote: number, channel: number) => {
      stopNote(midiNote, channel + 1);
      synth.noteOff(channel, midiNote);
    },
    [stopNote],
  );

  // The engine resolves all timing/flam/lookahead and emits fully-scheduled
  // note-ons, so JS just sends them. Scrub/preview notes arrive while the
  // transport is stopped and get no engine note-off, so auto-release those.
  const handleNoteOn = useCallback(
    (channel: number, midiNote: number, velocity: number) => {
      playSound(midiNote, velocity, channel);

      if (!engineRef.current?.getIsPlaying()) {
        const id = setTimeout(() => {
          pendingTimeouts.current.delete(id);
          stopSound(midiNote, channel);
        }, 80);
        pendingTimeouts.current.add(id);
      }
    },
    [playSound, stopSound],
  );

  const handleNoteOff = useCallback(
    (channel: number, midiNote: number) => {
      stopSound(midiNote, channel);
    },
    [stopSound],
  );

  // Sequenced mod-wheel (and any future CC): external gear only -- the
  // built-in synth receives the same modulation via onSoundParam.
  const handleMidiCc = useCallback(
    (channel: number, controller: number, value: number) => {
      if (selectedOutput) {
        sendControlChange(controller, value, channel + 1);
      }
    },
    [selectedOutput, sendControlChange],
  );

  // Read transport state from WASM
  const isPlaying = wasmEngine?.getIsPlaying() ?? false;
  const isExternalPlayback = wasmEngine?.getIsExternalPlayback() ?? false;
  const bpm = wasmEngine?.getBpm() ?? 120;
  const [swing, setSwingLocal] = useState(50);

  // Keep bpmRef in sync with actual BPM
  useEffect(() => {
    bpmRef.current = bpm;
  });

  const handlePlayNote = useCallback(
    (note: number, channel: number, lengthTicks?: number) => {
      playSound(note, 100, channel);
      const ticks = lengthTicks ?? TICKS_PER_QUARTER / 4;
      const tickDurationMs = 60000 / (bpmRef.current * TICKS_PER_QUARTER);
      const duration = Math.max(50, ticks * tickDurationMs - 10);
      setTimeout(() => stopSound(note, channel), duration);
    },
    [playSound, stopSound],
  );

  // Wire up step trigger and note-off callbacks
  useEffect(() => {
    const engine = engineRef.current;
    console.log("[startup] Wiring callbacks: engine=" + !!engine);
    if (engine) {
      engine.onNoteOn = handleNoteOn;
      engine.onNoteOff = handleNoteOff;
      engine.onMidiCc = handleMidiCc;
      engine.onPlayPreviewNote = (channel: number, row: number, lengthTicks: number) => {
        const isDrum = engine.getChannelType(channel) === 1;
        const midiNote = isDrum ? Math.max(0, Math.min(127, row)) : engine.noteToMidi(row);
        if (midiNote >= 0) {
          handlePlayNote(midiNote, channel, lengthTicks > 0 ? lengthTicks : undefined);
        }
      };
      // Sound mode: patch edits stream to the Rust synth; when the synth
      // (re)loads it pulls the engine's full patch state
      engine.onSoundParam = (channel: number, param: number, value: number) => {
        synth.setSoundParam(channel, param, value);
      };
      // Drum sampler: slot edits stream the same way; REC presses drive the
      // web-mic recorder, which feeds level/waveform state back to the engine
      engine.onSampleParam = (channel: number, slot: number, param: number, value: number) => {
        synth.setSlotParam(channel, slot, param, value);
      };
      // 808 kit: per-instrument edits stream to the Rust drum synth
      engine.onDrumParam = (channel: number, param: number, value: number) => {
        synth.setDrumParam(channel, param, value);
      };
      recorder.engine = engine;
      engine.onRecControl = (channel: number) => {
        void recorder.toggle(channel);
      };
      synth.onRustSynthReady = () => engine.syncSoundParams();
      if (synth.isRustSynthReady()) {
        engine.syncSoundParams();
      }
    }
    return () => {
      if (engine) {
        engine.onNoteOn = null;
        engine.onNoteOff = null;
        engine.onMidiCc = null;
        engine.onPlayPreviewNote = null;
        engine.onSoundParam = null;
        engine.onSampleParam = null;
        engine.onDrumParam = null;
        engine.onRecControl = null;
      }
      synth.onRustSynthReady = null;
    };
  }, [handleNoteOn, handleNoteOff, handleMidiCc, handlePlayNote, wasmEngine]);

  const clearPendingTimeouts = () => {
    pendingTimeouts.current.forEach(clearTimeout);
    pendingTimeouts.current.clear();
  };

  // Keep transport refs in sync for MIDI sync callbacks
  useEffect(() => {
    playExternalRef.current = actions.playExternal;
    stopExternalRef.current = () => {
      clearPendingTimeouts();
      actions.stopExternal();
      stopAllNotes();
      synth.allNotesOff();
    };
    externalTickRef.current = actions.externalTick;
    setBpmRef.current = actions.setBpm;
  });

  const handlePlay = useCallback(() => {
    synth.resume();
    actions.play();
  }, []);

  const handleStop = useCallback(() => {
    clearPendingTimeouts();
    actions.stop();
    stopAllNotes();
    synth.allNotesOff();
  }, [stopAllNotes]);

  const handleReset = useCallback(() => {
    clearPendingTimeouts();
    actions.resetPosition();
    stopAllNotes();
    synth.allNotesOff();
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

  // Sound output selection: a MIDI device, the built-in synth, or none.
  const handleOutputChange = useCallback(
    (output: Output | null) => {
      setSelectedOutput(output);
      // Explicitly picking a device (or "None") opts out of built-in sounds
      setBuiltinSound(false);
      localStorage.setItem(STORAGE_KEY_BUILTIN_SOUND, "0");
      synth.allNotesOff();
    },
    [setSelectedOutput],
  );

  const handleSelectBuiltinSound = useCallback(() => {
    setSelectedOutput(null);
    setBuiltinSound(true);
    localStorage.setItem(STORAGE_KEY_BUILTIN_SOUND, "1");
    synth.resume();
  }, [setSelectedOutput]);

  const handleConnectTeensy = useCallback(async () => {
    if (teensyConnected) {
      // Disconnect and switch back to WASM
      engineRef.current?.disconnect?.();
      // Reload a fresh WASM engine
      const fresh = new WasmEngine();
      await fresh.load();
      fresh.fullInit();
      // Channel types, zoom, BPM set by engine_core_init in Rust
      fresh.setBpm(bpm); // restore user's current BPM
      engineRef.current = fresh;
      setWasmEngine(fresh);
      actions.setEngine(fresh);
      setTeensyConnected(false);
      return;
    }

    try {
      // Wrap the existing WASM engine — keeps all patterns and state
      const currentWasm = engineRef.current;
      if (!currentWasm || !currentWasm.isReady()) return;

      // If already a TeensyEngine, grab its inner WASM engine
      const wasmToWrap =
        currentWasm instanceof TeensyEngine
          ? (currentWasm as unknown as { wasm: WasmEngine }).wasm
          : (currentWasm as WasmEngine);

      const teensy = new TeensyEngine(wasmToWrap);
      teensy.onConnectionChange = (connected) => {
        setTeensyConnected(connected);
      };

      await teensy.connect(); // Opens Web MIDI permission prompt

      engineRef.current = teensy;
      setWasmEngine(teensy);
      actions.setEngine(teensy);
      setTeensyConnected(true);
    } catch (e) {
      console.warn("Teensy connection failed:", e);
    }
  }, [teensyConnected, bpm]);

  // Don't render until the WASM engine is ready. MIDI is optional — on
  // platforms without Web MIDI (e.g. iPad Safari) the built-in synth is used.
  if (!wasmEngine) {
    console.log("[startup] Gated: wasmEngine=" + !!wasmEngine + " isEnabled=" + isEnabled);
    return (
      <ThemeProvider theme={caseTheme}>
        <CssBaseline />
        <Global styles={globalStyles} />
        <Box css={appContainerStyles}>
          <Box component="h1" css={titleStyles}>
            <span>Arpegginator</span>
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

  const scaled = fit.scale < 1 && fit.width > 0;

  return (
    <ThemeProvider theme={caseTheme}>
      <CssBaseline />
      <Global styles={globalStyles} />
      <Box css={rotateHintStyles}>Rotate to landscape</Box>
      <Box ref={fitContainerRef} css={appContainerStyles}>
        {/* Outer div reserves the scaled footprint so flex centering works;
            inner stage keeps its natural layout size and is scaled visually */}
        <div
          style={
            scaled
              ? {
                  width: fit.width * fit.scale,
                  height: fit.height * fit.scale,
                }
              : undefined
          }
        >
          <div
            ref={fitStageRef}
            css={stageStyles}
            style={
              scaled
                ? {
                    transform: `scale(${fit.scale})`,
                    transformOrigin: "top left",
                  }
                : undefined
            }
          >
            <Box component="h1" css={titleStyles}>
              <span>Arpegginator</span>
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
              onOutputChange={handleOutputChange}
              onInputChange={setSelectedInput}
              midiEnabled={isEnabled}
              builtinSoundSelected={builtinSound}
              onSelectBuiltinSound={handleSelectBuiltinSound}
            />
            <Box sx={{ display: "flex", justifyContent: "center", mb: 1 }}>
              <Box
                component="button"
                onClick={handleConnectTeensy}
                sx={{
                  background: "transparent",
                  border: "none",
                  color: teensyConnected ? "#6c6" : "#555",
                  cursor: "pointer",
                  fontSize: "10px",
                  letterSpacing: "1px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "2px 8px",
                  "&:hover": {
                    color: teensyConnected ? "#8e8" : "#888",
                  },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: teensyConnected ? "#6c6" : "#444",
                    boxShadow: teensyConnected ? "0 0 4px #6c6" : "none",
                  }}
                />
                {teensyConnected ? "TEENSY" : "WASM"}
              </Box>
            </Box>
            <Grid wasmEngine={wasmEngine} />
          </div>
        </div>
      </Box>
    </ThemeProvider>
  );
}

export default App;
