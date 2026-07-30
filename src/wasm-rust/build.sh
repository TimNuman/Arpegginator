#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
OUTPUT_DIR="$PROJECT_ROOT/public/wasm-rust"

# Check for Rust toolchain
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo (Rust) not found in PATH"
    echo "Install: https://rustup.rs/"
    exit 1
fi

# Ensure wasm32 target is installed
if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then
    echo "Installing wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown
fi

echo "Building Rust WASM engine..."
cd "$SCRIPT_DIR"
cargo rustc -p arpegginator-engine --target wasm32-unknown-unknown --release --crate-type cdylib

echo "Building Rust WASM synth..."
cargo rustc -p arpegginator-synth --target wasm32-unknown-unknown --release --crate-type cdylib

mkdir -p "$OUTPUT_DIR"
cp "$SCRIPT_DIR/target/wasm32-unknown-unknown/release/arpegginator_engine.wasm" "$OUTPUT_DIR/engine.wasm"
cp "$SCRIPT_DIR/target/wasm32-unknown-unknown/release/arpegginator_synth.wasm" "$OUTPUT_DIR/synth.wasm"

echo "Rust WASM build complete:"
ls -lh "$OUTPUT_DIR"/engine.* "$OUTPUT_DIR"/synth.*
