import { useEffect, useRef, useState, useCallback } from 'react';
import { WebMidi, Output } from 'webmidi';

export const useMidi = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeNotes = useRef<Map<number, Output>>(new Map());

  useEffect(() => {
    WebMidi.enable()
      .then(() => {
        setIsEnabled(true);
        setOutputs(WebMidi.outputs);
        if (WebMidi.outputs.length > 0) {
          setSelectedOutput(WebMidi.outputs[0]);
        }

        WebMidi.addListener('connected', () => {
          setOutputs([...WebMidi.outputs]);
        });

        WebMidi.addListener('disconnected', () => {
          setOutputs([...WebMidi.outputs]);
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

  return {
    isEnabled,
    outputs,
    selectedOutput,
    setSelectedOutput,
    error,
    playNote,
    stopNote,
    stopAllNotes,
  };
};
