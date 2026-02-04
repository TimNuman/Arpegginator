import { useState, useCallback, useRef, useEffect } from "react";
import type { GridState, NoteValue } from "../types/grid";
import { getNoteLength, getRepeatAmount, getRepeatSpace, createNotePattern } from "../types/grid";

const ROWS = 128; // Full MIDI range (0-127)
const COLS = 64;
const NUM_CHANNELS = 8;
const PATTERNS_PER_CHANNEL = 8;
const DEFAULT_LOOP_START = 0;
const DEFAULT_LOOP_LENGTH = 16;

interface PatternLoop {
  start: number;
  length: number;
}

// Create default loops for all patterns in all channels
const createDefaultLoops = (): PatternLoop[][] => {
  return Array.from({ length: NUM_CHANNELS }, () =>
    Array.from({ length: PATTERNS_PER_CHANNEL }, () => ({
      start: DEFAULT_LOOP_START,
      length: DEFAULT_LOOP_LENGTH,
    })),
  );
};

const createEmptyGrid = (): GridState => {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
};

// Each channel has multiple patterns
const createEmptyPatterns = (): GridState[] => {
  return Array.from({ length: PATTERNS_PER_CHANNEL }, () => createEmptyGrid());
};

// All channels with all their patterns
const createEmptyChannels = (): GridState[][] => {
  return Array.from({ length: NUM_CHANNELS }, () => createEmptyPatterns());
};

interface UseSequencerOptions {
  onStepTrigger: (channel: number, row: number, step: number, noteLength: number) => void;
}

export const useSequencer = ({ onStepTrigger }: UseSequencerOptions) => {
  const [channels, setChannels] = useState<GridState[][]>(createEmptyChannels);
  const [currentChannel, setCurrentChannel] = useState(0);
  const [currentPatterns, setCurrentPatterns] = useState<number[]>(() =>
    Array.from({ length: NUM_CHANNELS }, () => 0),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExternalPlayback, setIsExternalPlayback] = useState(false); // True when playback started by external MIDI
  const [bpm, setBpm] = useState(120);
  const [currentStep, setCurrentStep] = useState(-1);
  // Loops are per-pattern, not per-channel: patternLoops[channel][pattern]
  const [patternLoops, setPatternLoops] =
    useState<PatternLoop[][]>(createDefaultLoops);
  // Queued patterns - will switch at end of current loop (null = no queue)
  const [queuedPatterns, setQueuedPatterns] = useState<(number | null)[]>(() =>
    Array.from({ length: NUM_CHANNELS }, () => null),
  );
  // Muted channels - muted channels don't trigger notes
  const [mutedChannels, setMutedChannels] = useState<boolean[]>(() =>
    Array.from({ length: NUM_CHANNELS }, () => false),
  );
  // Soloed channels - when any channel is soloed, only soloed channels play
  const [soloedChannels, setSoloedChannels] = useState<boolean[]>(() =>
    Array.from({ length: NUM_CHANNELS }, () => false),
  );

  const intervalRef = useRef<number | null>(null);
  const channelsRef = useRef(channels);
  const currentPatternsRef = useRef(currentPatterns);
  const queuedPatternsRef = useRef(queuedPatterns);
  const mutedChannelsRef = useRef(mutedChannels);
  const soloedChannelsRef = useRef(soloedChannels);

  useEffect(() => {
    queuedPatternsRef.current = queuedPatterns;
  }, [queuedPatterns]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    currentPatternsRef.current = currentPatterns;
  }, [currentPatterns]);

  useEffect(() => {
    mutedChannelsRef.current = mutedChannels;
  }, [mutedChannels]);

  useEffect(() => {
    soloedChannelsRef.current = soloedChannels;
  }, [soloedChannels]);

  const currentPattern = currentPatterns[currentChannel];

  // Toggle mute for a channel
  const toggleMute = useCallback((channel: number) => {
    setMutedChannels((prev) => {
      const next = [...prev];
      next[channel] = !next[channel];
      return next;
    });
  }, []);

  // Toggle solo for a channel
  const toggleSolo = useCallback((channel: number) => {
    setSoloedChannels((prev) => {
      const next = [...prev];
      next[channel] = !next[channel];
      return next;
    });
  }, []);

  const setChannelPattern = useCallback(
    (channel: number, pattern: number) => {
      // If playing and selecting a different pattern, queue it instead of switching immediately
      if (isPlaying && currentPatternsRef.current[channel] !== pattern) {
        setQueuedPatterns((prev) => {
          const next = [...prev];
          // Toggle off if clicking the same queued pattern
          next[channel] = prev[channel] === pattern ? null : pattern;
          return next;
        });
      } else {
        // Not playing or selecting current pattern - switch immediately
        setCurrentPatterns((prev) => {
          const next = [...prev];
          next[channel] = pattern;
          return next;
        });
        // Clear any queue for this channel
        setQueuedPatterns((prev) => {
          const next = [...prev];
          next[channel] = null;
          return next;
        });
      }
    },
    [isPlaying],
  );

  // Helper to truncate any note that would overlap with a new note at col
  const truncateOverlappingNote = (gridRow: NoteValue[], col: number) => {
    // Look for any note starting before col that extends into col
    for (let c = 0; c < col; c++) {
      const noteValue = gridRow[c];
      const noteLength = getNoteLength(noteValue);
      if (noteLength > 0 && c + noteLength > col) {
        // This note overlaps - truncate it to end just before col
        const newLength = col - c;
        if (noteValue !== null) {
          // Preserve repeat settings
          gridRow[c] = { ...noteValue, length: newLength };
        }
      }
    }
  };

  const toggleCell = useCallback(
    (row: number, col: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        // Toggle: null -> NotePattern, NotePattern -> null
        const currentValue = newChannels[currentChannel][currentPattern][row][col];
        if (getNoteLength(currentValue) > 0) {
          // Turning off
          newChannels[currentChannel][currentPattern][row][col] = null;
        } else {
          // Turning on - truncate any overlapping note first
          truncateOverlappingNote(newChannels[currentChannel][currentPattern][row], col);
          newChannels[currentChannel][currentPattern][row][col] = createNotePattern(1);
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  // Set a note with a specific length (used for keyboard note-length input)
  const setNote = useCallback(
    (row: number, col: number, length: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        // Truncate any overlapping note first
        truncateOverlappingNote(newChannels[currentChannel][currentPattern][row], col);
        // Preserve repeat settings if note already exists
        const existingNote = newChannels[currentChannel][currentPattern][row][col];
        if (existingNote !== null) {
          newChannels[currentChannel][currentPattern][row][col] = { ...existingNote, length };
        } else {
          newChannels[currentChannel][currentPattern][row][col] = createNotePattern(length);
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  // Copy current pattern to a target pattern slot in the same channel
  const copyPatternTo = useCallback(
    (targetPattern: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) => {
                if (pIdx === targetPattern) {
                  // Deep copy the current pattern to the target
                  return prev[currentChannel][currentPattern].map((row) => [...row]);
                }
                return pattern;
              })
            : ch,
        );
        return newChannels;
      });
      // Also copy the loop settings
      setPatternLoops((prev) => {
        const newLoops = prev.map((channelLoops, chIdx) =>
          chIdx === currentChannel
            ? channelLoops.map((loop, pIdx) =>
                pIdx === targetPattern
                  ? { ...prev[currentChannel][currentPattern] }
                  : loop
              )
            : channelLoops
        );
        return newLoops;
      });
    },
    [currentChannel, currentPattern],
  );

  // Move a note from one position to another
  // Note: This does NOT truncate overlapping notes - the selected note passes over
  // other notes without affecting them. Truncation happens when the note is "placed"
  // (deselected) via the placeNote function.
  const moveNote = useCallback(
    (fromRow: number, fromCol: number, toRow: number, toCol: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        const grid = newChannels[currentChannel][currentPattern];
        const noteValue = grid[fromRow][fromCol];
        const noteLength = getNoteLength(noteValue);
        if (noteLength > 0) {
          // Clear the old position
          grid[fromRow][fromCol] = null;
          // Set the note at the new position (no truncation while moving)
          // Preserve the full NotePattern
          grid[toRow][toCol] = noteValue;
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  // Place a note at a position, truncating any overlapping notes
  // Called when a selected note is deselected (placed in its final position)
  const placeNote = useCallback(
    (row: number, col: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        const grid = newChannels[currentChannel][currentPattern];
        const noteValue = grid[row][col];
        const noteLength = getNoteLength(noteValue);
        if (noteLength > 0) {
          // Now truncate any overlapping notes at this position
          truncateOverlappingNote(grid[row], col);
          // Re-set the note (in case truncation affected it)
          grid[row][col] = noteValue;
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  // Update the repeat amount of a note
  const setNoteRepeatAmount = useCallback(
    (row: number, col: number, repeatAmount: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        const grid = newChannels[currentChannel][currentPattern];
        const noteValue = grid[row][col];
        if (noteValue !== null) {
          // Clamp length to not exceed repeatSpace (only if repeating)
          const clampedLength = repeatAmount > 1
            ? Math.min(noteValue.length, noteValue.repeatSpace)
            : noteValue.length;
          grid[row][col] = { ...noteValue, repeatAmount, length: clampedLength };
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  // Update the repeat space of a note
  const setNoteRepeatSpace = useCallback(
    (row: number, col: number, repeatSpace: number) => {
      setChannels((prev) => {
        const newChannels = prev.map((ch, chIdx) =>
          chIdx === currentChannel
            ? ch.map((pattern, pIdx) =>
                pIdx === currentPattern ? pattern.map((r) => [...r]) : pattern,
              )
            : ch,
        );
        const grid = newChannels[currentChannel][currentPattern];
        const noteValue = grid[row][col];
        if (noteValue !== null) {
          // Clamp length to not exceed the new repeatSpace (only if repeating)
          const clampedLength = noteValue.repeatAmount > 1
            ? Math.min(noteValue.length, repeatSpace)
            : noteValue.length;
          grid[row][col] = { ...noteValue, repeatSpace, length: clampedLength };
        }
        return newChannels;
      });
    },
    [currentChannel, currentPattern],
  );

  const clearGrid = useCallback(() => {
    setChannels((prev) => {
      const newChannels = prev.map((ch, chIdx) =>
        chIdx === currentChannel
          ? ch.map((pattern, pIdx) =>
              pIdx === currentPattern ? createEmptyGrid() : pattern,
            )
          : ch,
      );
      return newChannels;
    });
    // Also reset loop settings to default
    setPatternLoops((prev) => {
      const newLoops = prev.map((channelLoops, chIdx) =>
        chIdx === currentChannel
          ? channelLoops.map((loop, pIdx) =>
              pIdx === currentPattern
                ? { start: DEFAULT_LOOP_START, length: DEFAULT_LOOP_LENGTH }
                : loop
            )
          : channelLoops
      );
      return newLoops;
    });
  }, [currentChannel, currentPattern]);

  const clearAllChannels = useCallback(() => {
    setChannels(createEmptyChannels());
    setCurrentPatterns(Array.from({ length: NUM_CHANNELS }, () => 0));
    setPatternLoops(createDefaultLoops());
  }, []);

  const patternLoopsRef = useRef(patternLoops);

  useEffect(() => {
    patternLoopsRef.current = patternLoops;
  }, [patternLoops]);

  // Set loop for a specific pattern (uses current channel and pattern if not specified)
  const setPatternLoop = useCallback(
    (channel: number, pattern: number, start: number, length: number) => {
      setPatternLoops((prev) => {
        const next = prev.map((ch, chIdx) =>
          chIdx === channel
            ? ch.map((p, pIdx) => (pIdx === pattern ? { start, length } : p))
            : ch,
        );
        return next;
      });
    },
    [],
  );

  // Helper to get all notes (including repeats) that should play at a given step
  const getNotesAtStep = (
    pattern: NoteValue[][],
    step: number,
    loopStart: number,
    loopEnd: number
  ): { row: number; length: number }[] => {
    const notes: { row: number; length: number }[] = [];

    for (let row = 0; row < ROWS; row++) {
      // Check all columns from loop start up to and including the current step
      // to find notes that might play at this step (either directly or as repeats)
      for (let col = loopStart; col <= step; col++) {
        const noteValue = pattern[row][col];
        if (noteValue === null) continue;

        const { length, repeatAmount, repeatSpace } = noteValue;

        // Check if this note (or any of its repeats) plays at the current step
        for (let r = 0; r < repeatAmount; r++) {
          const playStep = col + r * repeatSpace;
          if (playStep === step && playStep < loopEnd) {
            notes.push({ row, length });
            break; // Only add once per row per step
          }
        }
      }
    }

    return notes;
  };

  const tick = useCallback(() => {
    setCurrentStep((prevStep) => {
      const nextStep = prevStep + 1;

      // Check for pattern switches at loop boundaries and trigger notes
      const patternsToSwitch: { channel: number; pattern: number }[] = [];

      for (let ch = 0; ch < NUM_CHANNELS; ch++) {
        const patternIdx = currentPatternsRef.current[ch];
        const loop = patternLoopsRef.current[ch][patternIdx];
        const loopEnd = loop.start + loop.length;
        // Calculate this pattern's position within its loop
        const channelStep =
          loop.start +
          ((((nextStep - loop.start) % loop.length) + loop.length) %
            loop.length);

        // Check if we're at the start of the loop (time to switch if queued)
        if (channelStep === loop.start) {
          const queuedPattern = queuedPatternsRef.current[ch];
          if (queuedPattern !== null) {
            patternsToSwitch.push({ channel: ch, pattern: queuedPattern });
          }
        }

        // Trigger notes (use current pattern, switch happens after)
        // A note triggers if: there's a note at this step, OR we're within a previous note's length
        // Check mute/solo state - if any channel is soloed, only soloed channels play
        const anySoloed = soloedChannelsRef.current.some((s) => s);
        const shouldPlay = anySoloed
          ? soloedChannelsRef.current[ch] && !mutedChannelsRef.current[ch]
          : !mutedChannelsRef.current[ch];

        if (shouldPlay && channelStep >= loop.start && channelStep < loopEnd) {
          // Get all notes that should play at this step (including repeats)
          const notesToPlay = getNotesAtStep(
            channelsRef.current[ch][patternIdx],
            channelStep,
            loop.start,
            loopEnd
          );
          for (const { row, length } of notesToPlay) {
            onStepTrigger(ch, row, channelStep, length);
          }
        }
      }

      // Apply pattern switches outside of the loop to avoid issues
      if (patternsToSwitch.length > 0) {
        setCurrentPatterns((prev) => {
          const next = [...prev];
          for (const { channel, pattern } of patternsToSwitch) {
            next[channel] = pattern;
          }
          return next;
        });
        setQueuedPatterns((prev) => {
          const next = [...prev];
          for (const { channel } of patternsToSwitch) {
            next[channel] = null;
          }
          return next;
        });
      }

      return nextStep;
    });
  }, [onStepTrigger]);

  const play = useCallback(() => {
    if (intervalRef.current) return;

    setIsPlaying(true);
    setIsExternalPlayback(false); // Internal playback
    const intervalMs = ((60 / bpm) * 1000) / 4;

    tick();
    intervalRef.current = window.setInterval(tick, intervalMs);
  }, [bpm, tick]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
    setIsExternalPlayback(false);
    setCurrentStep(-1);
    // Clear all queued patterns on stop
    setQueuedPatterns(Array.from({ length: NUM_CHANNELS }, () => null));
  }, []);

  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
    // Don't reset currentStep - keep playhead position
  }, []);

  const resetPlayhead = useCallback(() => {
    setCurrentStep(-1);
  }, []);

  // External tick for MIDI clock sync - advances sequencer without internal timer
  const externalTick = useCallback(() => {
    if (!isPlaying) return;
    tick();
  }, [isPlaying, tick]);

  // Start playback without internal timer (for external sync)
  const playExternal = useCallback(() => {
    // Clear any existing internal timer
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(true);
    setIsExternalPlayback(true); // External playback from MIDI
  }, []);

  // Stop without resetting (for external sync continue support)
  const stopExternal = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
    setIsExternalPlayback(false);
    setCurrentStep(-1);
    setQueuedPatterns(Array.from({ length: NUM_CHANNELS }, () => null));
  }, []);

  useEffect(() => {
    if (isPlaying && intervalRef.current) {
      clearInterval(intervalRef.current);
      const intervalMs = ((60 / bpm) * 1000) / 4;
      intervalRef.current = window.setInterval(tick, intervalMs);
    }
  }, [bpm, isPlaying, tick]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Current channel's current pattern grid state
  const gridState = channels[currentChannel][currentPattern];

  // Check which channels have notes (in any pattern)
  const channelsHaveNotes = channels.map((ch) =>
    ch.some((pattern) => pattern.some((row) => row.some((cell) => getNoteLength(cell) > 0))),
  );

  // Check which patterns have notes for each channel (2D array: [channel][pattern] -> boolean)
  const allPatternsHaveNotes = channels.map((ch) =>
    ch.map((pattern) => pattern.some((row) => row.some((cell) => getNoteLength(cell) > 0))),
  );

  // Check which channels are playing a note at the current step
  // A channel is playing if there's a note starting at this step, or if we're within a note's length
  const channelsPlayingNow = channels.map((ch, chIdx) => {
    if (currentStep < 0) return false;
    const patternIdx = currentPatterns[chIdx];
    const loop = patternLoops[chIdx][patternIdx];
    const channelStep =
      loop.start +
      ((((currentStep - loop.start) % loop.length) + loop.length) %
        loop.length);
    // Check if any row has a note starting at this step, or we're within a note's length
    return ch[patternIdx].some((row) => {
      // Check if note starts at this step
      if (getNoteLength(row[channelStep]) > 0) return true;
      // Check if we're within a previous note's length or a repeat
      for (let col = loop.start; col < channelStep; col++) {
        const noteValue = row[col];
        const noteLength = getNoteLength(noteValue);
        if (noteLength > 0) {
          // Check main note
          if (col + noteLength > channelStep) {
            return true;
          }
          // Check repeats
          const repeatAmount = getRepeatAmount(noteValue);
          const repeatSpace = getRepeatSpace(noteValue);
          if (repeatAmount > 1) {
            for (let r = 1; r < repeatAmount; r++) {
              const repeatStart = col + r * repeatSpace;
              if (channelStep >= repeatStart && channelStep < repeatStart + noteLength) {
                return true;
              }
            }
          }
        }
      }
      return false;
    });
  });

  // Current pattern's loop (for the current channel)
  const currentLoop = patternLoops[currentChannel][currentPattern];

  // Check if we're on a pulse beat (every 4 steps) for queued pattern animation
  const isPulseBeat = currentStep >= 0 && currentStep % 4 === 0;

  return {
    gridState,
    channels,
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
    isExternalPlayback,
    bpm,
    currentStep,
    toggleCell,
    setNote,
    moveNote,
    placeNote,
    setNoteRepeatAmount,
    setNoteRepeatSpace,
    copyPatternTo,
    clearGrid,
    clearAllChannels,
    play,
    stop,
    pause,
    resetPlayhead,
    setBpm,
    currentLoop,
    setPatternLoop,
    // Mute/Solo
    mutedChannels,
    soloedChannels,
    toggleMute,
    toggleSolo,
    // External sync functions
    externalTick,
    playExternal,
    stopExternal,
  };
};

export const CHANNEL_COLORS = [
  "#ff3366", // Hot pink
  "#ff6633", // Orange
  "#ffcc00", // Yellow
  "#66ff33", // Lime green
  "#33ffcc", // Cyan
  "#3366ff", // Blue
  "#9933ff", // Purple
  "#ff33cc", // Magenta
];
