import { useState, useCallback, useRef, useEffect } from "react";
import type { GridState } from "../types/grid";

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
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
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
  const truncateOverlappingNote = (gridRow: number[], col: number) => {
    // Look for any note starting before col that extends into col
    for (let c = 0; c < col; c++) {
      const noteLength = gridRow[c];
      if (noteLength > 0 && c + noteLength > col) {
        // This note overlaps - truncate it to end just before col
        gridRow[c] = col - c;
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
        // Toggle: 0 -> 1 (default length), >0 -> 0
        const currentValue = newChannels[currentChannel][currentPattern][row][col];
        if (currentValue > 0) {
          // Turning off
          newChannels[currentChannel][currentPattern][row][col] = 0;
        } else {
          // Turning on - truncate any overlapping note first
          truncateOverlappingNote(newChannels[currentChannel][currentPattern][row], col);
          newChannels[currentChannel][currentPattern][row][col] = 1;
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
        newChannels[currentChannel][currentPattern][row][col] = length;
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
          for (let row = 0; row < ROWS; row++) {
            const noteLength = channelsRef.current[ch][patternIdx][row][channelStep];
            if (noteLength > 0) {
              // Note starts here - pass the length for proper note duration
              onStepTrigger(ch, row, channelStep, noteLength);
            }
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
    ch.some((pattern) => pattern.some((row) => row.some((cell) => cell > 0))),
  );

  // Check which patterns have notes for each channel (2D array: [channel][pattern] -> boolean)
  const allPatternsHaveNotes = channels.map((ch) =>
    ch.map((pattern) => pattern.some((row) => row.some((cell) => cell > 0))),
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
      if (row[channelStep] > 0) return true;
      // Check if we're within a previous note's length
      for (let col = loop.start; col < channelStep; col++) {
        const noteLength = row[col];
        if (noteLength > 0 && col + noteLength > channelStep) {
          return true;
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
