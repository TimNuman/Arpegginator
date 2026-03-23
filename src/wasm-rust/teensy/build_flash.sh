#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKSPACE_DIR="$SCRIPT_DIR/.."
TARGET_DIR="$WORKSPACE_DIR/target/thumbv7em-none-eabihf/release"

echo "Building Arp3 Teensy firmware..."
cd "$SCRIPT_DIR"
cargo build --release

# Convert ELF to HEX
echo "Converting ELF to HEX..."
if command -v llvm-objcopy &> /dev/null; then
    llvm-objcopy -O ihex "$TARGET_DIR/arp3-teensy" "$TARGET_DIR/arp3-teensy.hex"
elif command -v arm-none-eabi-objcopy &> /dev/null; then
    arm-none-eabi-objcopy -O ihex "$TARGET_DIR/arp3-teensy" "$TARGET_DIR/arp3-teensy.hex"
else
    echo "Error: Neither llvm-objcopy nor arm-none-eabi-objcopy found."
    echo "Install LLVM tools: brew install llvm"
    echo "  or ARM toolchain: brew install arm-none-eabi-gcc"
    exit 1
fi

echo "HEX file: $TARGET_DIR/arp3-teensy.hex"
ls -lh "$TARGET_DIR/arp3-teensy.hex"

# Flash to Teensy if teensy_loader_cli is available
if command -v teensy_loader_cli &> /dev/null; then
    echo "Flashing to Teensy 4.1..."
    teensy_loader_cli --mcu=TEENSY41 -w -v "$TARGET_DIR/arp3-teensy.hex"
else
    echo ""
    echo "teensy_loader_cli not found. To flash manually:"
    echo "  1. Install: brew install teensy_loader_cli"
    echo "  2. Run: teensy_loader_cli --mcu=TEENSY41 -w -v $TARGET_DIR/arp3-teensy.hex"
    echo "  Or use the Teensy Loader GUI application."
fi
