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
    "_engine_play_init",
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
    "_engine_get_sub_mode_array_size",
    "_engine_get_continue_counter",
    "_engine_set_ui_mode",
    "_engine_set_modify_sub_mode",
    "_engine_set_current_channel",
    "_engine_set_zoom",
    "_engine_set_selected_event",
    "_engine_set_row_offset",
    "_engine_set_col_offset",
    "_engine_set_bpm",
    "_engine_set_is_playing",
    "_engine_set_ctrl_held",
    "_engine_set_channel_color",
    "_engine_set_scale_root",
    "_engine_set_scale_id_idx",
    "_engine_get_ui_mode",
    "_engine_get_modify_sub_mode",
    "_engine_get_current_channel",
    "_engine_get_zoom",
    "_engine_get_selected_event",
    "_engine_get_bpm",
    "_engine_get_is_playing",
    "_engine_get_button_values_buffer",
    "_engine_get_color_overrides_buffer",
    "_engine_get_patterns_have_notes_buffer",
    "_engine_get_channels_playing_now_buffer",
    "_engine_get_event_count",
    "_engine_get_pattern_length",
    "_engine_alloc_event_id_export",
    "_engine_compute_grid_export",
    "_engine_toggle_event_export",
    "_engine_remove_event_export",
    "_engine_move_event_export",
    "_engine_set_event_length_export",
    "_engine_place_event_export",
    "_engine_set_event_repeat_amount_export",
    "_engine_set_event_repeat_space_export",
    "_engine_set_sub_mode_value_export",
    "_engine_set_sub_mode_length_export",
    "_engine_toggle_sub_mode_loop_mode_export",
    "_engine_adjust_chord_stack_export",
    "_engine_cycle_chord_shape_export",
    "_engine_cycle_chord_inversion_export",
    "_engine_copy_pattern_export",
    "_engine_clear_pattern_export",
    "_engine_button_press_export",
    "_engine_arrow_press_export",
    "_engine_key_action_export"
]'
# Remove whitespace from JSON
EXPORTED_FUNCTIONS=$(echo "$EXPORTED_FUNCTIONS" | tr -d '[:space:]')

emcc "$SCRIPT_DIR/engine_core.c" "$SCRIPT_DIR/engine_ui.c" "$SCRIPT_DIR/engine_edit.c" "$SCRIPT_DIR/engine_input.c" "$SCRIPT_DIR/engine_wasm.c" \
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
