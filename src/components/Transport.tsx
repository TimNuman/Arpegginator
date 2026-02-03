import { css } from '@emotion/react';
import { Box, IconButton, Slider, Typography, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Output, Input } from 'webmidi';

const transportStyles = css`
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 24px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;

const controlGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const bpmSliderStyles = css`
  width: 150px;
  color: #66ffcc;

  .MuiSlider-thumb {
    background-color: #66ffcc;
  }

  .MuiSlider-track {
    background-color: #66ffcc;
  }

  .MuiSlider-rail {
    background-color: rgba(102, 255, 204, 0.3);
  }
`;

const playButtonStyles = css`
  background: linear-gradient(145deg, #33ff66, #22cc44);
  color: #000;
  width: 48px;
  height: 48px;

  &:hover {
    background: linear-gradient(145deg, #44ff77, #33dd55);
  }

  &.Mui-disabled {
    background: linear-gradient(145deg, #444, #333);
    color: rgba(255, 255, 255, 0.3);
  }
`;

const stopButtonStyles = css`
  background: linear-gradient(145deg, #ff3366, #cc2244);
  color: #fff;
  width: 48px;
  height: 48px;

  &:hover {
    background: linear-gradient(145deg, #ff4477, #dd3355);
  }
`;

const clearButtonStyles = css`
  background: linear-gradient(145deg, #666, #444);
  color: #fff;
  width: 40px;
  height: 40px;

  &:hover {
    background: linear-gradient(145deg, #777, #555);
  }
`;

const labelStyles = css`
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const bpmValueStyles = css`
  color: #66ffcc;
  font-size: 24px;
  font-weight: bold;
  font-family: 'Courier New', monospace;
  min-width: 60px;
  text-align: center;
`;

const midiSelectStyles = css`
  min-width: 200px;

  .MuiOutlinedInput-root {
    color: #fff;
    background: rgba(0, 0, 0, 0.3);

    fieldset {
      border-color: rgba(255, 255, 255, 0.2);
    }

    &:hover fieldset {
      border-color: rgba(255, 255, 255, 0.4);
    }

    &.Mui-focused fieldset {
      border-color: #66ffcc;
    }
  }

  .MuiInputLabel-root {
    color: rgba(255, 255, 255, 0.5);
  }

  .MuiSelect-icon {
    color: rgba(255, 255, 255, 0.5);
  }
`;

interface TransportProps {
  isPlaying: boolean;
  isExternalPlayback: boolean;
  bpm: number;
  onPlay: () => void;
  onStop: () => void;
  onClear: () => void;
  onBpmChange: (bpm: number) => void;
  midiOutputs: Output[];
  midiInputs: Input[];
  selectedOutput: Output | null;
  selectedInput: Input | null;
  onOutputChange: (output: Output | null) => void;
  onInputChange: (input: Input | null) => void;
  midiEnabled: boolean;
}

export const Transport = ({
  isPlaying,
  isExternalPlayback,
  bpm,
  onPlay,
  onStop,
  onClear,
  onBpmChange,
  midiOutputs,
  midiInputs,
  selectedOutput,
  selectedInput,
  onOutputChange,
  onInputChange,
  midiEnabled,
}: TransportProps) => {
  // In slave mode (external playback from MIDI), show disabled play button
  const isSlaveMode = selectedInput !== null;
  const showDisabledPlayButton = isPlaying && isExternalPlayback;

  return (
    <Box css={transportStyles}>
      <Box css={controlGroupStyles}>
        <IconButton
          css={showDisabledPlayButton ? playButtonStyles : (isPlaying ? stopButtonStyles : playButtonStyles)}
          onClick={showDisabledPlayButton ? undefined : (isPlaying ? onStop : onPlay)}
          disabled={showDisabledPlayButton}
        >
          {showDisabledPlayButton ? <PlayArrowIcon /> : (isPlaying ? <StopIcon /> : <PlayArrowIcon />)}
        </IconButton>
        <IconButton css={clearButtonStyles} onClick={onClear}>
          <DeleteOutlineIcon />
        </IconButton>
      </Box>

      <Box css={controlGroupStyles}>
        <Typography css={labelStyles}>BPM</Typography>
        <Slider
          css={bpmSliderStyles}
          value={bpm}
          min={40}
          max={240}
          onChange={(_, value) => onBpmChange(value as number)}
          disabled={isSlaveMode}
        />
        <Typography css={bpmValueStyles}>{bpm}</Typography>
      </Box>

      <FormControl css={midiSelectStyles} size="small">
        <InputLabel>MIDI Output</InputLabel>
        <Select
          value={selectedOutput?.id || ''}
          label="MIDI Output"
          onChange={(e) => {
            const output = midiOutputs.find((o) => o.id === e.target.value) || null;
            onOutputChange(output);
          }}
          disabled={!midiEnabled}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {midiOutputs.map((output) => (
            <MenuItem key={output.id} value={output.id}>
              {output.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl css={midiSelectStyles} size="small">
        <InputLabel>MIDI Input (Sync)</InputLabel>
        <Select
          value={selectedInput?.id || ''}
          label="MIDI Input (Sync)"
          onChange={(e) => {
            const input = midiInputs.find((i) => i.id === e.target.value) || null;
            onInputChange(input);
          }}
          disabled={!midiEnabled}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {midiInputs.map((input) => (
            <MenuItem key={input.id} value={input.id}>
              {input.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {!midiEnabled && (
        <Typography sx={{ color: 'rgba(255, 100, 100, 0.8)', fontSize: '12px' }}>
          MIDI not available
        </Typography>
      )}
    </Box>
  );
};
