import { Box, Slider, Typography, Select, MenuItem, FormControl, InputLabel } from "@mui/material";
import { Output, Input } from "webmidi";
import { chrome } from "../theme/chrome";
import {
  transportStyles,
  controlGroupStyles,
  bpmSliderStyles,
  labelStyles,
  bpmValueStyles,
  midiSelectStyles,
  readoutStyles,
} from "./Transport.styles";

interface TransportProps {
  isExternalPlayback: boolean;
  bpm: number;
  swing: number;
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
const BUILTIN_SOUND_ID = "builtin";

export const Transport = ({
  isExternalPlayback,
  bpm,
  swing,
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
  return (
    <Box css={transportStyles}>
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
          css={readoutStyles}
          style={{ width: 54 }}
        />
      </Box>

      <FormControl css={midiSelectStyles} size="small">
        <InputLabel>Sound Output</InputLabel>
        <Select
          value={selectedOutput?.id || (builtinSoundSelected ? BUILTIN_SOUND_ID : "")}
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
          value={selectedInput?.id || ""}
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
        <Typography
          sx={{
            color: chrome.caseShadow,
            fontFamily: chrome.font,
            fontSize: "8px",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Web MIDI unavailable — built-in sounds active
        </Typography>
      )}
    </Box>
  );
};
