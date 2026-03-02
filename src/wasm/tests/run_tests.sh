#!/bin/bash
# run_tests.sh — Compile and run C unit tests using CUnit
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WASM_DIR="$(dirname "$SCRIPT_DIR")"
cd "$WASM_DIR"

# Find CUnit via Homebrew
CUNIT_PREFIX="$(brew --prefix cunit 2>/dev/null || echo /opt/homebrew)"

echo "Compiling tests..."
cc -o tests/test_runner \
    tests/test_stubs.c \
    tests/test_core.c \
    tests/test_edit.c \
    tests/test_oled.c \
    tests/test_rendered.c \
    engine_core.c \
    engine_ui.c \
    engine_edit.c \
    engine_input.c \
    oled_gfx.c \
    oled_fonts.c \
    -I. -I"${CUNIT_PREFIX}/include" \
    -L"${CUNIT_PREFIX}/lib" \
    -lcunit -lm \
    -Wall -Wextra -Wno-unused-parameter -Wno-unused-function \
    -std=c11

echo "Running tests..."
echo ""
tests/test_runner
EXIT_CODE=$?

# Clean up
rm -f tests/test_runner

exit $EXIT_CODE
