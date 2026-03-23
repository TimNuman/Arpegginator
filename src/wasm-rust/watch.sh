#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Watching src/wasm-rust/{engine/src/*.rs,engine/Cargo.toml,wasm/src/*.rs} for changes..."
echo "Press Ctrl+C to stop."

# Initial build
bash "$SCRIPT_DIR/build.sh"

# Watch for changes using polling (no extra deps needed)
LAST_HASH=""
while true; do
    HASH=$(cat "$SCRIPT_DIR"/engine/src/*.rs "$SCRIPT_DIR"/engine/Cargo.toml "$SCRIPT_DIR"/wasm/src/*.rs 2>/dev/null | shasum)
    if [ "$HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
        echo ""
        echo "$(date +%H:%M:%S) Change detected, rebuilding..."
        if bash "$SCRIPT_DIR/build.sh"; then
            echo "$(date +%H:%M:%S) ✓ Build OK"
        else
            echo "$(date +%H:%M:%S) ✗ Build failed"
        fi
    fi
    LAST_HASH="$HASH"
    sleep 1
done
