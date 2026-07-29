import { Box, IconButton, Slider, Typography, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
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
  swing: number;
  onPlay: () => void;
  onStop: () => void;
  onReset: () => void;
  onClear: () => void;
  onBpmChange: (bpm: number) => void;
  onSwingChange: (swing: number) => void;
  midiOutputs: Output[];
  midiInputs: Input[];
  selectedOutput: Output | null;
  selectedInput: Input | null;
  onOutputChange: (output: Output | null) => void;
  onInputChange: (input: Input | null) => void;
  midiEnabled: boolean;
  builtinSoundSelected: boolean;
  onSelectBuiltinSound: () => void;
}

// Sentinel value for the built-in Web Audio synth in the output selector
const BUILTIN_SOUND_ID = 'builtin';

export const Transport = ({
  isPlaying,
  isExternalPlayback,
  bpm,
  swing,
  onPlay,
  onStop,
  onReset,
  onClear,
  onBpmChange,
  onSwingChange,
  midiOutputs,
  midiInputs,
  selectedOutput,
  selectedInput,
  onOutputChange,
  onInputChange,
  midiEnabled,
  builtinSoundSelected,
  onSelectBuiltinSound,
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
          {showDisabledPlayButton ? <PlayArrowIcon /> : (isPlaying ? <PauseIcon /> : <PlayArrowIcon />)}
        </IconButton>
        <IconButton css={clearButtonStyles} onClick={onReset}>
          <SkipPreviousIcon />
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

      <Box css={controlGroupStyles}>
        <Typography css={labelStyles}>SWG</Typography>
        <input
          type="number"
          value={swing}
          min={50}
          max={75}
          onChange={(e) => {
            const v = Math.max(50, Math.min(75, Number(e.target.value)));
            onSwingChange(v);
          }}
          style={{
            width: 48,
            background: 'transparent',
            border: '1px solid rgba(102, 255, 204, 0.3)',
            borderRadius: 4,
            color: '#66ffcc',
            fontSize: 14,
            padding: '2px 4px',
            textAlign: 'center',
          }}
        />
      </Box>

      <FormControl css={midiSelectStyles} size="small">
        <InputLabel>Sound Output</InputLabel>
        <Select
          value={
            selectedOutput?.id ||
            (builtinSoundSelected ? BUILTIN_SOUND_ID : '')
          }
          label="Sound Output"
          onChange={(e) => {
            if (e.target.value === BUILTIN_SOUND_ID) {
              onSelectBuiltinSound();
              return;
            }
            const output = midiOutputs.find((o) => o.id === e.target.value) || null;
            onOutputChange(output);
          }}
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          <MenuItem value={BUILTIN_SOUND_ID}>Built-in (808 + Piano)</MenuItem>
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
        <Typography sx={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: '12px' }}>
          Web MIDI unavailable — built-in sounds active
        </Typography>
      )}
    </Box>
  );
};
