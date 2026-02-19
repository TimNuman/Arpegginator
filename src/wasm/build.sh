#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
OUTPUT_DIR="$PROJECT_ROOT/public/wasm"

if ! command -v emcc &> /dev/null; then
    echo "Error: emcc (Emscripten) not found in PATH"
    echo "Install: brew install emscripten"
    echo "Or: https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

echo "Building WASM engine..."
emcc --version | head -n 1

mkdir -p "$OUTPUT_DIR"

EXPORTED_FUNCTIONS='[
    "_engine_init",
    "_engine_tick",
    "_engine_stop",
    "_engine_get_version",
    "_engine_get_event_buffer",
    "_engine_set_event_count",
    "_engine_set_pattern_length",
    "_engine_get_loops_buffer",
    "_engine_get_scale_buffer",
    "_engine_set_scale_info",
    "_engine_get_muted_buffer",
    "_engine_get_soloed_buffer",
    "_engine_get_channel_types_buffer",
    "_engine_get_current_patterns_buffer",
    "_engine_get_queued_patterns_buffer",
    "_engine_set_rng_seed",
    "_engine_get_note_event_size",
    "_engine_get_field_offset",
    "_engine_get_sub_mode_array_size"
]'
# Remove whitespace from JSON
EXPORTED_FUNCTIONS=$(echo "$EXPORTED_FUNCTIONS" | tr -d '[:space:]')

emcc "$SCRIPT_DIR/engine_core.c" "$SCRIPT_DIR/engine_wasm.c" \
    -O2 \
    -I"$SCRIPT_DIR" \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8"]' \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createWasmEngine' \
    -s ENVIRONMENT='web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=4194304 \
    -o "$OUTPUT_DIR/engine.js"

echo "WASM build complete:"
ls -lh "$OUTPUT_DIR"/engine.*
