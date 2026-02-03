import { useEffect, useRef, useState, useCallback } from 'react';
import { WebMidi, Output, Input } from 'webmidi';

// Transport event callbacks
export interface MidiTransportCallbacks {
  onStart?: () => void;
  onStop?: () => void;
  onContinue?: () => void;
  onClock?: () => void; // Called every 16th note (6 MIDI clock pulses)
  onTempoChange?: (bpm: number) => void; // Called when tempo is detected from clock
}

// MIDI clock constants
const MIDI_CLOCK_PPQ = 24; // 24 pulses per quarter note
const CLOCKS_PER_16TH = 6; // 24 PPQ / 4 (16th notes per quarter) = 6
const TEMPO_SAMPLE_SIZE = 96; // Average over 4 quarter notes for stability
const TEMPO_HYSTERESIS = 2; // BPM must change by more than this to update

// localStorage keys for persisting MIDI device selections
const STORAGE_KEY_OUTPUT = 'arp3-midi-output';
const STORAGE_KEY_INPUT = 'arp3-midi-input';

export const useMidi = (transportCallbacks?: MidiTransportCallbacks) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [inputs, setInputs] = useState<Input[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<Output | null>(null);
  const [selectedInput, setSelectedInput] = useState<Input | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeNotes = useRef<Map<number, Output>>(new Map());
  const transportCallbacksRef = useRef(transportCallbacks);

  // MIDI clock tracking for sync
  const clockPulseCount = useRef<number>(0);
  // Tempo detection from clock
  const clockTimestamps = useRef<number[]>([]);
  const lastReportedBpm = useRef<number>(0);

  // Keep transport callbacks ref up to date
  useEffect(() => {
    transportCallbacksRef.current = transportCallbacks;
  }, [transportCallbacks]);

  useEffect(() => {
    WebMidi.enable()
      .then(() => {
        setIsEnabled(true);
        setOutputs(WebMidi.outputs);
        setInputs(WebMidi.inputs);

        // Try to restore previously selected output from localStorage
        const savedOutputName = localStorage.getItem(STORAGE_KEY_OUTPUT);
        const savedInputName = localStorage.getItem(STORAGE_KEY_INPUT);

        // Find and select the saved output, or fall back to first available
        if (savedOutputName) {
          const savedOutput = WebMidi.outputs.find(o => o.name === savedOutputName);
          if (savedOutput) {
            setSelectedOutput(savedOutput);
          } else if (WebMidi.outputs.length > 0) {
            setSelectedOutput(WebMidi.outputs[0]);
          }
        } else if (WebMidi.outputs.length > 0) {
          setSelectedOutput(WebMidi.outputs[0]);
        }

        // Find and select the saved input (no fallback - input is optional)
        if (savedInputName) {
          const savedInput = WebMidi.inputs.find(i => i.name === savedInputName);
          if (savedInput) {
            setSelectedInput(savedInput);
          }
        }

        WebMidi.addListener('connected', () => {
          setOutputs([...WebMidi.outputs]);
          setInputs([...WebMidi.inputs]);
        });

        WebMidi.addListener('disconnected', () => {
          setOutputs([...WebMidi.outputs]);
          setInputs([...WebMidi.inputs]);
        });
      })
      .catch((err) => {
        setError(err.message);
        console.error('WebMidi could not be enabled:', err);
      });

    return () => {
      if (WebMidi.enabled) {
        WebMidi.disable();
      }
    };
  }, []);

  // Set up transport listeners on selected input
  useEffect(() => {
    if (!selectedInput) return;

    const handleStart = () => {
      // Reset clock tracking on start
      clockPulseCount.current = 0;
      clockTimestamps.current = [];
      transportCallbacksRef.current?.onStart?.();
    };

    const handleStop = () => {
      // Reset clock tracking on stop
      clockPulseCount.current = 0;
      clockTimestamps.current = [];
      transportCallbacksRef.current?.onStop?.();
    };

    const handleContinue = () => {
      transportCallbacksRef.current?.onContinue?.();
    };

    const handleClock = () => {
      const now = performance.now();

      // Track timestamps for tempo detection
      clockTimestamps.current.push(now);
      if (clockTimestamps.current.length > TEMPO_SAMPLE_SIZE) {
        clockTimestamps.current.shift();
      }

      // Calculate and report BPM when we have enough samples
      if (clockTimestamps.current.length >= TEMPO_SAMPLE_SIZE) {
        const oldest = clockTimestamps.current[0];
        const newest = clockTimestamps.current[clockTimestamps.current.length - 1];
        const elapsedMs = newest - oldest;
        const tickCount = clockTimestamps.current.length - 1;

        // Convert to BPM: (ticks / elapsed_ms) * (1000 ms/s) * (60 s/min) / (24 ticks/quarter)
        const ticksPerMs = tickCount / elapsedMs;
        const ticksPerMinute = ticksPerMs * 60000;
        const bpm = Math.round(ticksPerMinute / MIDI_CLOCK_PPQ);

        // Only report if BPM changed significantly (hysteresis avoids oscillation)
        if (Math.abs(bpm - lastReportedBpm.current) > TEMPO_HYSTERESIS && bpm >= 20 && bpm <= 300) {
          lastReportedBpm.current = bpm;
          transportCallbacksRef.current?.onTempoChange?.(bpm);
        }
      }

      // Advance sequencer every 6 clock pulses (= 1 sixteenth note)
      clockPulseCount.current++;
      if (clockPulseCount.current >= CLOCKS_PER_16TH) {
        clockPulseCount.current = 0;
        transportCallbacksRef.current?.onClock?.();
      }
    };

    // Listen for MIDI transport messages
    selectedInput.addListener('start', handleStart);
    selectedInput.addListener('stop', handleStop);
    selectedInput.addListener('continue', handleContinue);
    selectedInput.addListener('clock', handleClock);

    return () => {
      selectedInput.removeListener('start', handleStart);
      selectedInput.removeListener('stop', handleStop);
      selectedInput.removeListener('continue', handleContinue);
      selectedInput.removeListener('clock', handleClock);
    };
  }, [selectedInput]);

  const playNote = useCallback(
    (note: number, velocity = 100, channel = 1) => {
      if (selectedOutput) {
        selectedOutput.channels[channel].playNote(note, { attack: velocity / 127 });
        activeNotes.current.set(note, selectedOutput);
      }
    },
    [selectedOutput]
  );

  const stopNote = useCallback(
    (note: number, channel = 1) => {
      const output = activeNotes.current.get(note);
      if (output) {
        output.channels[channel].stopNote(note);
        activeNotes.current.delete(note);
      }
    },
    []
  );

  const stopAllNotes = useCallback(() => {
    if (selectedOutput) {
      for (let ch = 1; ch <= 16; ch++) {
        selectedOutput.channels[ch].sendAllNotesOff();
      }
    }
    activeNotes.current.clear();
  }, [selectedOutput]);

  // Wrapper to save output selection to localStorage
  const selectOutput = useCallback((output: Output | null) => {
    setSelectedOutput(output);
    if (output) {
      localStorage.setItem(STORAGE_KEY_OUTPUT, output.name);
    } else {
      localStorage.removeItem(STORAGE_KEY_OUTPUT);
    }
  }, []);

  // Wrapper to save input selection to localStorage
  const selectInput = useCallback((input: Input | null) => {
    setSelectedInput(input);
    if (input) {
      localStorage.setItem(STORAGE_KEY_INPUT, input.name);
    } else {
      localStorage.removeItem(STORAGE_KEY_INPUT);
    }
  }, []);

  return {
    isEnabled,
    outputs,
    inputs,
    selectedOutput,
    selectedInput,
    setSelectedOutput: selectOutput,
    setSelectedInput: selectInput,
    error,
    playNote,
    stopNote,
    stopAllNotes,
  };
};
