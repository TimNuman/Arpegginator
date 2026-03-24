#!/bin/bash
# Build and flash Teensy without pressing the button.
# Sends a SysEx reboot command via MIDI, then flashes the new firmware.
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_DIR="$SCRIPT_DIR/.."
TARGET_DIR="$WORKSPACE_DIR/target/thumbv7em-none-eabihf/release"
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

echo "Building..."
cd "$SCRIPT_DIR"
cargo build --release

echo "Converting ELF to HEX..."
llvm-objcopy -O ihex "$TARGET_DIR/arp3-teensy" "$TARGET_DIR/arp3-teensy.hex"

# Try to reboot Teensy into bootloader via MIDI SysEx
echo "Sending reboot command via MIDI..."
python3 -c "
import sys
try:
    import rtmidi
    out = rtmidi.MidiOut()
    for i in range(out.get_port_count()):
        if 'Arp3' in out.get_port_name(i):
            out.open_port(i)
            # SysEx: F0 7D 21 F7 (CMD_REBOOT)
            out.send_message([0xF0, 0x7D, 0x21, 0xF7])
            print('Reboot command sent')
            out.close_port()
            sys.exit(0)
    print('Arp3 Sequencer not found on MIDI, press the button manually')
except ImportError:
    print('python-rtmidi not installed, press the button manually')
    print('Install: pip3 install --user --break-system-packages python-rtmidi')
" 2>/dev/null || true

sleep 2

echo "Flashing..."
teensy_loader_cli --mcu=TEENSY41 -w -v "$TARGET_DIR/arp3-teensy.hex"
