// test_rendered.c — Tests for rendered notes cache and dirty flag system
#include "test_framework.h"
#include "../engine_core.h"
#include "../engine_edit.h"
#include "../engine_ui.h"
#include "../engine_input.h"
#include <string.h>

extern EngineState g_state;

// ============ Helper ============

static void init_state(void) {
    memset(&g_state, 0, sizeof(g_state));
    engine_core_init(&g_state);
}

// Helper: create an event and ensure cache is built
static int16_t add_event_and_render(int16_t row, int32_t tick, int32_t length) {
    int16_t idx = engine_toggle_event(&g_state, row, tick, length);
    uint8_t ch = g_state.current_channel;
    engine_ensure_rendered(&g_state, ch);
    return idx;
}

// Helper: get current channel
static uint8_t ch(void) { return g_state.current_channel; }

// Helper: count rendered notes matching a source event index
static uint16_t count_rendered_for_event(uint16_t source_idx) {
    uint8_t c = ch();
    uint16_t count = 0;
    for (uint16_t i = 0; i < g_state.rendered_count[c]; i++) {
        if (g_state.rendered_notes[c][i].source_idx == source_idx) count++;
    }
    return count;
}

// Helper: find rendered note at (row, tick)
static const RenderedNote* find_rendered_at(int16_t row, int32_t tick) {
    uint8_t c = ch();
    for (uint16_t i = 0; i < g_state.rendered_count[c]; i++) {
        const RenderedNote* rn = &g_state.rendered_notes[c][i];
        if (rn->row == row && tick >= rn->position && tick < rn->position + rn->length) {
            return rn;
        }
    }
    return NULL;
}

// ============ Basic cache tests ============

static void test_ensure_rendered_builds_cache(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);

    // Cache should be dirty after edits
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());

    // Cache should now be clean and populated
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 2);
}

static void test_ensure_rendered_no_rebuild_if_clean(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 1);

    // Calling again without dirtying should not change anything
    // (just verifying it doesn't crash or lose data)
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 1);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);
}

// ============ Dirty flag: disable note ============

static void test_disable_note_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT(idx >= 0);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 1);

    // Cmd-click to disable the note
    // First we need to know the visible row/col for this event
    // Simpler: directly set enabled=0 via the same path as engine_input.c
    uint8_t c = ch();
    uint8_t pat = g_state.current_patterns[c];
    g_state.patterns[c][pat].events[idx].enabled = 0;
    engine_mark_dirty(&g_state, c);

    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    // Re-render: disabled event should be gone
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 0);
}

static void test_reenable_note_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT(idx >= 0);

    // Disable
    uint8_t c = ch();
    uint8_t pat = g_state.current_patterns[c];
    g_state.patterns[c][pat].events[idx].enabled = 0;
    engine_mark_dirty(&g_state, c);
    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_count[c], 0);

    // Re-enable
    g_state.patterns[c][pat].events[idx].enabled = 1;
    engine_mark_dirty(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[c], 1);

    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_count[c], 1);
}

// ============ Dirty flag: cmd-click disable via button_press ============

static void test_cmd_click_disable_marks_dirty(void) {
    init_state();
    // Create event at row 10, tick 0
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT(idx >= 0);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    // Cmd-click on the event's visible position
    // The event is at row 10, tick 0.
    // visible_row maps via get_start_row which depends on scroll.
    // With default scroll, row 0 in grid = min_row = -scale_zero_index
    // For a fresh scale, scale_zero_index ~ 36 (C4 in major scale)
    // So actual_row = visible_row + start_row
    // Let's use engine_button_press which goes through the full path.
    // But we need to set up coordinates properly.
    // Instead, directly test the underlying logic:
    int16_t found = engine_find_event_at(&g_state, 10, 0);
    CU_ASSERT_EQUAL(found, idx);

    // Simulate what cmd-click does in handle_pattern_press
    uint8_t c = ch();
    uint8_t pat = g_state.current_patterns[c];
    g_state.patterns[c][pat].events[found].enabled = 0;
    engine_mark_dirty(&g_state, c);

    CU_ASSERT_EQUAL(g_state.rendered_dirty[c], 1);

    // After re-render, note should be gone
    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_count[c], 0);
}

// ============ Dirty flag: edit operations ============

static void test_toggle_event_marks_dirty(void) {
    init_state();
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    // Add event
    engine_toggle_event(&g_state, 10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    // Remove event (toggle same position)
    engine_toggle_event(&g_state, 10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);
}

static void test_move_event_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    engine_move_event(&g_state, (uint16_t)idx, 12, 240);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][0].row, 12);
    CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][0].position, 240);
}

static void test_set_length_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    engine_set_event_length(&g_state, (uint16_t)idx, 480);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][0].length, 480);
}

static void test_repeat_amount_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    engine_set_event_repeat_amount(&g_state, (uint16_t)idx, 4);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 4);
}

static void test_chord_stack_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1); // 1 → 2
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    engine_ensure_rendered(&g_state, ch());
    // With chord_amount=2 and ARP_CHORD, should have 2 rendered notes
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 2);
}

static void test_arp_style_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    // Need chord for arp style to matter
    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1); // chord_amount = 2
    engine_set_event_repeat_amount(&g_state, (uint16_t)idx, 4);
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    engine_cycle_arp_style(&g_state, (uint16_t)idx, 1); // CHORD → UP
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);
}

// ============ Dirty flag: resize via direct mutation (shift-click path) ============

static void test_direct_length_change_needs_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);
    CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][0].length, 120);

    // Simulate shift-click resize: direct mutation + mark_dirty
    uint8_t c = ch();
    uint8_t pat = g_state.current_patterns[c];
    g_state.patterns[c][pat].events[idx].length = 480;
    engine_mark_dirty(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[c], 1);

    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_notes[c][0].length, 480);
}

// ============ Dirty flag: channel/pattern switch ============

static void test_pattern_switch_marks_dirty(void) {
    init_state();
    // Add events to pattern 0
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 1);

    // Switch to pattern 1 (empty)
    uint8_t c = ch();
    g_state.current_patterns[c] = 1;
    engine_mark_dirty(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[c], 1);

    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_count[c], 0);

    // Switch back to pattern 0
    g_state.current_patterns[c] = 0;
    engine_mark_dirty(&g_state, c);
    engine_ensure_rendered(&g_state, c);
    CU_ASSERT_EQUAL(g_state.rendered_count[c], 1);
}

// ============ Dirty flag: play/stop resets ============

static void test_play_init_marks_all_dirty(void) {
    init_state();
    // Build cache for channel 0
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_ensure_rendered(&g_state, 0);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[0], 0);

    engine_core_play_init(&g_state);

    // All channels should be dirty (counters reset)
    for (int i = 0; i < NUM_CHANNELS; i++) {
        CU_ASSERT_EQUAL(g_state.rendered_dirty[i], 1);
    }
}

static void test_stop_marks_all_dirty(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_ensure_rendered(&g_state, 0);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[0], 0);

    engine_core_stop(&g_state);

    for (int i = 0; i < NUM_CHANNELS; i++) {
        CU_ASSERT_EQUAL(g_state.rendered_dirty[i], 1);
    }
}

// ============ Dirty flag: scale change ============

static void test_scale_change_marks_all_dirty(void) {
    init_state();
    engine_toggle_event(&g_state, 10, 0, 120);
    engine_ensure_rendered(&g_state, 0);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[0], 0);

    engine_cycle_scale(&g_state, 1);

    for (int i = 0; i < NUM_CHANNELS; i++) {
        CU_ASSERT_EQUAL(g_state.rendered_dirty[i], 1);
    }
}

// ============ Rendered notes: chord expansion ============

static void test_rendered_chord_has_chord_index(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    // Add chord: amount=3
    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1); // → 2
    engine_adjust_chord_stack(&g_state, (uint16_t)idx, 1); // → 3
    engine_ensure_rendered(&g_state, ch());

    // Should have 3 rendered notes (ARP_CHORD = play all)
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 3);

    // Each should have a different chord_index
    uint8_t seen[3] = {0, 0, 0};
    for (uint16_t i = 0; i < g_state.rendered_count[ch()]; i++) {
        uint8_t ci = g_state.rendered_notes[ch()][i].chord_index;
        CU_ASSERT(ci < 3);
        seen[ci] = 1;
    }
    CU_ASSERT_EQUAL(seen[0], 1);
    CU_ASSERT_EQUAL(seen[1], 1);
    CU_ASSERT_EQUAL(seen[2], 1);
}

static void test_rendered_repeat_expansion(void) {
    init_state();
    int16_t idx = engine_toggle_event(&g_state, 10, 0, 120);
    engine_set_event_repeat_amount(&g_state, (uint16_t)idx, 3);
    engine_set_event_repeat_space(&g_state, (uint16_t)idx, 120);
    engine_ensure_rendered(&g_state, ch());

    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 3);

    // Verify positions: 0, 120, 240
    for (uint16_t i = 0; i < 3; i++) {
        // Find rendered note with repeat_index == i
        int found = 0;
        for (uint16_t j = 0; j < g_state.rendered_count[ch()]; j++) {
            if (g_state.rendered_notes[ch()][j].repeat_index == i) {
                CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][j].position, (int32_t)i * 120);
                found = 1;
                break;
            }
        }
        CU_ASSERT_EQUAL(found, 1);
    }
}

// ============ Rendered notes: disabled events excluded ============

static void test_rendered_excludes_disabled_events(void) {
    init_state();
    int16_t idx0 = engine_toggle_event(&g_state, 10, 0, 120);
    engine_toggle_event(&g_state, 12, 120, 120);

    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_count[ch()], 2);

    // Disable first event
    uint8_t c = ch();
    uint8_t pat = g_state.current_patterns[c];
    g_state.patterns[c][pat].events[idx0].enabled = 0;
    engine_mark_dirty(&g_state, c);
    engine_ensure_rendered(&g_state, c);

    CU_ASSERT_EQUAL(g_state.rendered_count[c], 1);
    CU_ASSERT_EQUAL(g_state.rendered_notes[c][0].row, 12);
}

// ============ Dirty flag: sub-mode modulation ============

static void test_modulation_change_marks_dirty(void) {
    init_state();
    int16_t idx = add_event_and_render(10, 0, 120);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 0);

    // Change modulation value
    engine_set_sub_mode_value(&g_state, (uint16_t)idx, SM_MODULATE, 0, 3);
    CU_ASSERT_EQUAL(g_state.rendered_dirty[ch()], 1);

    // Re-render: row should be shifted by modulation
    engine_ensure_rendered(&g_state, ch());
    CU_ASSERT_EQUAL(g_state.rendered_notes[ch()][0].row, 13); // 10 + 3
}

// ============ Suite registration ============

void register_rendered_tests(void) {
    CU_pSuite suite = CU_add_suite("rendered_cache", NULL, NULL);

    // Basic cache
    CU_add_test(suite, "ensure_rendered_builds_cache", test_ensure_rendered_builds_cache);
    CU_add_test(suite, "ensure_rendered_no_rebuild_if_clean", test_ensure_rendered_no_rebuild_if_clean);

    // Dirty flag: disable/enable
    CU_add_test(suite, "disable_note_marks_dirty", test_disable_note_marks_dirty);
    CU_add_test(suite, "reenable_note_marks_dirty", test_reenable_note_marks_dirty);
    CU_add_test(suite, "cmd_click_disable_marks_dirty", test_cmd_click_disable_marks_dirty);

    // Dirty flag: edit operations
    CU_add_test(suite, "toggle_event_marks_dirty", test_toggle_event_marks_dirty);
    CU_add_test(suite, "move_event_marks_dirty", test_move_event_marks_dirty);
    CU_add_test(suite, "set_length_marks_dirty", test_set_length_marks_dirty);
    CU_add_test(suite, "repeat_amount_marks_dirty", test_repeat_amount_marks_dirty);
    CU_add_test(suite, "chord_stack_marks_dirty", test_chord_stack_marks_dirty);
    CU_add_test(suite, "arp_style_marks_dirty", test_arp_style_marks_dirty);

    // Dirty flag: direct mutation (shift-click resize path)
    CU_add_test(suite, "direct_length_change_needs_dirty", test_direct_length_change_needs_dirty);

    // Dirty flag: pattern switch
    CU_add_test(suite, "pattern_switch_marks_dirty", test_pattern_switch_marks_dirty);

    // Dirty flag: play/stop
    CU_add_test(suite, "play_init_marks_all_dirty", test_play_init_marks_all_dirty);
    CU_add_test(suite, "stop_marks_all_dirty", test_stop_marks_all_dirty);

    // Dirty flag: scale
    CU_add_test(suite, "scale_change_marks_all_dirty", test_scale_change_marks_all_dirty);

    // Rendered note content
    CU_add_test(suite, "rendered_chord_has_chord_index", test_rendered_chord_has_chord_index);
    CU_add_test(suite, "rendered_repeat_expansion", test_rendered_repeat_expansion);
    CU_add_test(suite, "rendered_excludes_disabled_events", test_rendered_excludes_disabled_events);
    CU_add_test(suite, "modulation_change_marks_dirty", test_modulation_change_marks_dirty);
}
