import { Box, IconButton, Slider, Typography, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Output, Input } from 'webmidi';
import {
  transportStyles,
  controlGroupStyles,
  bpmSliderStyles,
  playButtonStyles,
  stopButtonStyles,
  clearButtonStyles,
  labelStyles,
  bpmValueStyles,
  midiSelectStyles,
} from './Transport.styles';

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
          disabled={isExternalPlayback}
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
