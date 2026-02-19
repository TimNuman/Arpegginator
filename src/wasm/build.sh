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

emcc "$SCRIPT_DIR/engine.c" \
    -O3 \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -s EXPORTED_FUNCTIONS='["_engine_add","_engine_tick","_engine_init","_engine_get_version"]' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createWasmEngine' \
    -s ENVIRONMENT='web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -o "$OUTPUT_DIR/engine.js"

echo "WASM build complete:"
ls -lh "$OUTPUT_DIR"/engine.*
