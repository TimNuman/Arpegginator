// test_edit.c — Tests for engine_edit.c functions
#include "test_framework.h"
#include "../engine_core.h"
#include "../engine_edit.h"
#include <string.h>

extern EngineState g_state;

// ============ Helper ============

static void init_state(void) {
    memset(&g_state, 0, sizeof(g_state));
    engine_core_init(&g_state);
}

// ============ engine_toggle_event ============

static void test_toggle_add_event(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    CU_ASSERT(idx >= 0);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].event_count, 1);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].row, 10);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].position, 0);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].length, 120);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].enabled, 1);
}

static void test_toggle_remove_event(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    CU_ASSERT_EQUAL(idx, -1);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].event_count, 0);
}

static void test_toggle_multiple_events(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);
    engine_toggle_event(&g_state, 14, 240, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].event_count, 3);
}

static void test_toggle_event_default_values(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 5, 0, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    NoteEvent_C* ev = &g_state.patterns[ch][pat].events[idx];
    CU_ASSERT_EQUAL(ev->repeat_amount, 1);
    CU_ASSERT_EQUAL(ev->chord_amount, 1);
    CU_ASSERT_EQUAL(ev->chord_space, 2);
    CU_ASSERT_EQUAL(ev->arp_style, ARP_CHORD);
    CU_ASSERT_EQUAL(ev->sub_modes[SM_VELOCITY].values[0], 100);
    CU_ASSERT_EQUAL(ev->sub_modes[SM_VELOCITY].length, 1);
    CU_ASSERT_EQUAL(ev->sub_modes[SM_HIT].values[0], 100);
}

// ============ engine_remove_event ============

static void test_remove_event_fixes_selection(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);
    g_state.selected_event_idx = 1;
    engine_remove_event(&g_state, 0);
    CU_ASSERT_EQUAL(g_state.selected_event_idx, 0);
}

static void test_remove_event_clears_selection(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    g_state.selected_event_idx = 0;
    engine_remove_event(&g_state, 0);
    CU_ASSERT_EQUAL(g_state.selected_event_idx, -1);
}

// ============ engine_move_event ============

static void test_move_event_basic(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_move_event(&g_state, (uint16_t)idx, 20, 240);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].row, 20);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].position, 240);
}

static void test_move_event_out_of_range_ignored(void) {
    init_state();
    engine_move_event(&g_state, 99, 20, 240); // should not crash
}

// ============ engine_set_event_length ============

static void test_set_length_basic(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_event_length(&g_state, (uint16_t)idx, 240);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].length, 240);
}

static void test_set_length_min_clamp(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_event_length(&g_state, (uint16_t)idx, 0);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].length, 1);
}

// ============ Sub-mode operations ============

static void test_sub_mode_value_basic(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_sub_mode_value(&g_state, (uint16_t)idx, SM_VELOCITY, 0, 80);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY].values[0], 80);
}

static void test_sub_mode_value_materializes_array(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_sub_mode_value(&g_state, (uint16_t)idx, SM_VELOCITY, 2, 50);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    SubModeArray* arr = &g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY];
    CU_ASSERT_EQUAL(arr->length, 3);
    CU_ASSERT_EQUAL(arr->values[2], 50);
    CU_ASSERT_EQUAL(arr->values[1], 100); // looped from index 0
}

static void test_sub_mode_length_expand(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_sub_mode_length(&g_state, (uint16_t)idx, SM_VELOCITY, 4);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY].length, 4);
}

static void test_sub_mode_length_shrink(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_sub_mode_length(&g_state, (uint16_t)idx, SM_VELOCITY, 4);
    engine_set_sub_mode_length(&g_state, (uint16_t)idx, SM_VELOCITY, 2);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY].length, 2);
}

static void test_sub_mode_length_clamp_min(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_sub_mode_length(&g_state, (uint16_t)idx, SM_VELOCITY, 0);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY].length, 1);
}

static void test_toggle_loop_mode_cycles(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    SubModeArray* arr = &g_state.patterns[ch][pat].events[idx].sub_modes[SM_VELOCITY];

    CU_ASSERT_EQUAL(arr->loop_mode, LOOP_RESET);
    engine_toggle_sub_mode_loop_mode(&g_state, (uint16_t)idx, SM_VELOCITY);
    CU_ASSERT_EQUAL(arr->loop_mode, LOOP_CONTINUE);
    engine_toggle_sub_mode_loop_mode(&g_state, (uint16_t)idx, SM_VELOCITY);
    CU_ASSERT_EQUAL(arr->loop_mode, LOOP_FILL);
    engine_toggle_sub_mode_loop_mode(&g_state, (uint16_t)idx, SM_VELOCITY);
    CU_ASSERT_EQUAL(arr->loop_mode, LOOP_RESET);
}

// ============ Chord operations ============

static void test_chord_stack_increase(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    NoteEvent_C* ev = &g_state.patterns[ch][pat].events[idx];

    CU_ASSERT_EQUAL(ev->chord_amount, 1);
    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1);
    CU_ASSERT_EQUAL(ev->chord_amount, 2);
    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1);
    CU_ASSERT_EQUAL(ev->chord_amount, 3);
}

static void test_chord_stack_decrease_clamp(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    NoteEvent_C* ev = &g_state.patterns[ch][pat].events[idx];

    engine_adjust_chord_stack(&g_state, (uint16_t)idx, -1);
    CU_ASSERT_EQUAL(ev->chord_amount, 1);
}

static void test_chord_stack_max_clamp(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    NoteEvent_C* ev = &g_state.patterns[ch][pat].events[idx];

    for (int i = 0; i < 20; i++)
        engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1);
    CU_ASSERT(ev->chord_amount <= MAX_CHORD_SIZE);
}

// ============ Pattern operations ============

static void test_copy_pattern(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);
    engine_copy_pattern(&g_state, 1);
    uint8_t ch = g_state.current_channel;
    CU_ASSERT_EQUAL(g_state.patterns[ch][1].event_count, 2);
    CU_ASSERT_EQUAL(g_state.patterns[ch][1].events[0].row, 10);
    CU_ASSERT_EQUAL(g_state.patterns[ch][1].events[1].row, 12);
}

static void test_clear_pattern(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].event_count, 2);
    engine_clear_pattern(&g_state);
    CU_ASSERT_EQUAL(g_state.patterns[ch][pat].event_count, 0);
}

// ============ Suite registration ============

void register_edit_tests(void) {
    CU_pSuite suite = CU_add_suite("engine_edit", NULL, NULL);

    CU_add_test(suite, "toggle_add_event", test_toggle_add_event);
    CU_add_test(suite, "toggle_remove_event", test_toggle_remove_event);
    CU_add_test(suite, "toggle_multiple_events", test_toggle_multiple_events);
    CU_add_test(suite, "toggle_event_default_values", test_toggle_event_default_values);

    CU_add_test(suite, "remove_event_fixes_selection", test_remove_event_fixes_selection);
    CU_add_test(suite, "remove_event_clears_selection", test_remove_event_clears_selection);

    CU_add_test(suite, "move_event_basic", test_move_event_basic);
    CU_add_test(suite, "move_event_out_of_range_ignored", test_move_event_out_of_range_ignored);

    CU_add_test(suite, "set_length_basic", test_set_length_basic);
    CU_add_test(suite, "set_length_min_clamp", test_set_length_min_clamp);

    CU_add_test(suite, "sub_mode_value_basic", test_sub_mode_value_basic);
    CU_add_test(suite, "sub_mode_value_materializes_array", test_sub_mode_value_materializes_array);
    CU_add_test(suite, "sub_mode_length_expand", test_sub_mode_length_expand);
    CU_add_test(suite, "sub_mode_length_shrink", test_sub_mode_length_shrink);
    CU_add_test(suite, "sub_mode_length_clamp_min", test_sub_mode_length_clamp_min);
    CU_add_test(suite, "toggle_loop_mode_cycles", test_toggle_loop_mode_cycles);

    CU_add_test(suite, "chord_stack_increase", test_chord_stack_increase);
    CU_add_test(suite, "chord_stack_decrease_clamp", test_chord_stack_decrease_clamp);
    CU_add_test(suite, "chord_stack_max_clamp", test_chord_stack_max_clamp);

    CU_add_test(suite, "copy_pattern", test_copy_pattern);
    CU_add_test(suite, "clear_pattern", test_clear_pattern);
}
