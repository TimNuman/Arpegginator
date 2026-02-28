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
    "_engine_play_init_from_tick",
    "_engine_tick",
    "_engine_scrub_to_tick",
    "_engine_scrub_end",
    "_engine_stop",
    "_engine_get_version",
    "_engine_get_event_buffer",
    "_engine_set_event_count",
    "_engine_set_pattern_length",
    "_engine_get_loops_buffer",
    "_engine_note_to_midi_export",
    "_engine_get_scale_name",
    "_engine_get_scale_count",
    "_engine_get_scale_zero_index",
    "_engine_get_num_scales",
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
    "_engine_get_row_offset",
    "_engine_set_col_offset",
    "_engine_get_col_offset",
    "_engine_set_bpm",
    "_engine_set_is_playing",
    "_engine_set_ctrl_held",
    "_engine_set_channel_color",
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
    "_engine_is_animating_export",
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
    "_engine_adjust_chord_space_export",
    "_engine_cycle_chord_inversion_export",
    "_engine_copy_pattern_export",
    "_engine_clear_pattern_export",
    "_engine_button_press_export",
    "_engine_arrow_press_export",
    "_engine_key_action_export",
    "_engine_get_sel_row",
    "_engine_get_sel_length",
    "_engine_get_sel_repeat_amount",
    "_engine_get_sel_repeat_space",
    "_engine_get_sel_chord_amount",
    "_engine_get_sel_chord_space",
    "_engine_get_sel_chord_inversion",
    "_engine_get_sel_chord_voicing",
    "_engine_get_voicing_count_export",
    "_engine_get_voicing_name_export",
    "_engine_get_sel_sub_mode_loop_mode",
    "_engine_get_sel_sub_mode_array_length",
    "_engine_get_current_loop_start",
    "_engine_get_current_loop_length",
    "_engine_get_current_pattern_length_ticks",
    "_engine_get_current_tick",
    "_engine_get_current_pattern",
    "_engine_get_channel_type",
    "_engine_get_scale_root",
    "_engine_get_scale_id_idx",
    "_engine_get_visible_rows",
    "_engine_get_visible_cols",
    "_engine_get_num_channels",
    "_oled_init",
    "_oled_clear",
    "_oled_draw_text",
    "_oled_draw_hline",
    "_oled_draw_vline",
    "_oled_draw_line",
    "_oled_draw_rect",
    "_oled_fill_rect",
    "_oled_draw_pixel",
    "_oled_text_width",
    "_oled_font_height",
    "_oled_get_framebuffer",
    "_oled_get_framebuffer_size"
]'
# Remove whitespace from JSON
EXPORTED_FUNCTIONS=$(echo "$EXPORTED_FUNCTIONS" | tr -d '[:space:]')

emcc "$SCRIPT_DIR/engine_core.c" "$SCRIPT_DIR/engine_ui.c" "$SCRIPT_DIR/engine_edit.c" "$SCRIPT_DIR/engine_input.c" "$SCRIPT_DIR/engine_wasm.c" \
    "$SCRIPT_DIR/oled_gfx.c" "$SCRIPT_DIR/oled_fonts.c" "$SCRIPT_DIR/oled_display.c" \
    -O2 \
    -I"$SCRIPT_DIR" \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8","HEAPU16","UTF8ToString"]' \
    -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createWasmEngine' \
    -s ENVIRONMENT='web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=16777216 \
    -o "$OUTPUT_DIR/engine.js"

echo "WASM build complete:"
ls -lh "$OUTPUT_DIR"/engine.*
