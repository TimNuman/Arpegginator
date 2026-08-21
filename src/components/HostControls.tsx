import type { Output, Input } from "webmidi";
import type { CapStyle } from "./ButtonGrid/ButtonGrid";

/**
 * HostControls — the browser's controls, not the instrument's.
 *
 * Picking a MIDI port and setting a tempo are things the *host* does; a real
 * AG-16 reads its clock off MIDI or its own encoders and has DIN sockets on
 * the back. Keeping these as plain HTML in the corner of the page, outside
 * the enclosure, is what lets the machine itself stay a machine.
 */

const BUILTIN_SOUND_ID = "builtin";

interface HostControlsProps {
  bpm: number;
  swing: number;
  isExternalPlayback: boolean;
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
  teensyConnected: boolean;
  onConnectTeensy: () => void;
  capStyle: CapStyle;
  onCapStyleChange: (style: CapStyle) => void;
}

export const HostControls = ({
  bpm,
  swing,
  isExternalPlayback,
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
  teensyConnected,
  onConnectTeensy,
  capStyle,
  onCapStyleChange,
}: HostControlsProps) => (
  <div
    style={{
      position: "fixed",
      top: 10,
      right: 12,
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      gap: 10,
      font: "12px system-ui, sans-serif",
      color: "#b9b9b4",
    }}
  >
    {/* Which engine is driving — a simulator concern; the real AG-16 has no
        such switch, so it does not belong on the case. */}
    <button type="button" onClick={onConnectTeensy}>
      {teensyConnected ? "Teensy" : "WASM"}
    </button>

    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      Caps
      <select value={capStyle} onChange={(e) => onCapStyleChange(e.target.value as CapStyle)}>
        <option value="clear">Clear over Choc</option>
        <option value="diffuser">Milky disc, centred LED</option>
        <option value="diffuserNorth">Milky disc over the real LED</option>
      </select>
    </label>

    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      BPM
      <input
        type="number"
        min={40}
        max={240}
        value={bpm}
        disabled={isExternalPlayback}
        onChange={(e) => onBpmChange(Math.max(40, Math.min(240, Number(e.target.value))))}
        style={{ width: 56 }}
      />
    </label>

    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      Swing
      <input
        type="number"
        min={50}
        max={75}
        value={swing}
        onChange={(e) => onSwingChange(Math.max(50, Math.min(75, Number(e.target.value))))}
        style={{ width: 52 }}
      />
    </label>

    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      Out
      <select
        value={selectedOutput?.id || (builtinSoundSelected ? BUILTIN_SOUND_ID : "")}
        onChange={(e) => {
          const id = e.target.value;
          if (id === BUILTIN_SOUND_ID) {
            onSelectBuiltinSound();
            return;
          }
          onOutputChange(midiOutputs.find((o) => o.id === id) || null);
        }}
      >
        <option value="">{midiEnabled ? "None" : "No Web MIDI"}</option>
        <option value={BUILTIN_SOUND_ID}>Built-in (808 + Piano)</option>
        {midiOutputs.map((output) => (
          <option key={output.id} value={output.id}>
            {output.name}
          </option>
        ))}
      </select>
    </label>

    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
      Sync in
      <select
        value={selectedInput?.id || ""}
        onChange={(e) => onInputChange(midiInputs.find((i) => i.id === e.target.value) || null)}
      >
        <option value="">None</option>
        {midiInputs.map((input) => (
          <option key={input.id} value={input.id}>
            {input.name}
          </option>
        ))}
      </select>
    </label>
  </div>
);
