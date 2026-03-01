// test_core.c — Tests for engine_core.c functions
#include "test_framework.h"
#include "../engine_core.h"
#include <string.h>

extern EngineState g_state;

// ============ Helper ============

static void init_state(void) {
    memset(&g_state, 0, sizeof(g_state));
    engine_core_init(&g_state);
}

// ============ engine_core_init ============

static void test_init_defaults(void) {
    init_state();
    CU_ASSERT_EQUAL(g_state.ui_mode, UI_PATTERN);
    CU_ASSERT_EQUAL(g_state.modify_sub_mode, SM_VELOCITY);
    CU_ASSERT_EQUAL(g_state.current_channel, 0);
    CU_ASSERT_EQUAL(g_state.zoom, ZOOM_1_16);
    CU_ASSERT_EQUAL(g_state.selected_event_idx, -1);
    CU_ASSERT_EQUAL(g_state.current_tick, -1);
    CU_ASSERT_EQUAL(g_state.is_playing, 0);
    CU_ASSERT_EQUAL(g_state.scale_root, 0);
    CU_ASSERT_EQUAL(g_state.scale_id_idx, 0);
}

static void test_init_pattern_lengths(void) {
    init_state();
    for (int ch = 0; ch < NUM_CHANNELS; ch++) {
        for (int pat = 0; pat < NUM_PATTERNS; pat++) {
            CU_ASSERT_EQUAL(g_state.patterns[ch][pat].length_ticks, TICKS_PER_QUARTER * 4 * 4);
            CU_ASSERT_EQUAL(g_state.loops[ch][pat].start, 0);
            CU_ASSERT_EQUAL(g_state.loops[ch][pat].length, TICKS_PER_QUARTER * 4);
        }
    }
}

static void test_init_queued_patterns_negative(void) {
    init_state();
    for (int ch = 0; ch < NUM_CHANNELS; ch++) {
        CU_ASSERT_EQUAL(g_state.queued_patterns[ch], -1);
    }
}

// ============ note_to_midi ============

static void test_note_to_midi_c4(void) {
    init_state();
    CU_ASSERT_EQUAL(note_to_midi(0, &g_state), 60);
}

static void test_note_to_midi_above(void) {
    init_state();
    CU_ASSERT_EQUAL(note_to_midi(1, &g_state), 62);
    CU_ASSERT_EQUAL(note_to_midi(2, &g_state), 64);
}

static void test_note_to_midi_below(void) {
    init_state();
    CU_ASSERT_EQUAL(note_to_midi(-1, &g_state), 59);
}

static void test_note_to_midi_out_of_range(void) {
    init_state();
    CU_ASSERT_EQUAL(note_to_midi(1000, &g_state), -1);
    CU_ASSERT_EQUAL(note_to_midi(-1000, &g_state), -1);
}

// ============ engine_rebuild_scale ============

static void test_rebuild_scale_c_major(void) {
    init_state();
    CU_ASSERT_EQUAL(g_state.scale_octave_size, 7);
    CU_ASSERT_EQUAL(g_state.scale_notes[g_state.scale_zero_index], 60);
    CU_ASSERT(g_state.scale_count > 50);
    CU_ASSERT(g_state.scale_count < 128);
}

static void test_rebuild_scale_chromatic(void) {
    init_state();
    g_state.scale_id_idx = 14;
    g_state.scale_root = 0;
    engine_rebuild_scale(&g_state);
    CU_ASSERT_EQUAL(g_state.scale_octave_size, 12);
    CU_ASSERT_EQUAL(g_state.scale_count, 128);
    CU_ASSERT_EQUAL(note_to_midi(0, &g_state), 60);
    CU_ASSERT_EQUAL(note_to_midi(1, &g_state), 61);
}

static void test_rebuild_scale_d_major(void) {
    init_state();
    g_state.scale_root = 2;
    g_state.scale_id_idx = 0;
    engine_rebuild_scale(&g_state);
    CU_ASSERT_EQUAL(note_to_midi(0, &g_state), 62);
    CU_ASSERT_EQUAL(g_state.scale_octave_size, 7);
}

// ============ engine_cycle_scale ============

static void test_cycle_scale_forward(void) {
    init_state();
    CU_ASSERT_EQUAL(g_state.scale_id_idx, 0);
    engine_cycle_scale(&g_state, 1);
    CU_ASSERT_EQUAL(g_state.scale_id_idx, 1);
}

static void test_cycle_scale_wrap_forward(void) {
    init_state();
    g_state.scale_id_idx = NUM_SCALES - 1;
    engine_cycle_scale(&g_state, 1);
    CU_ASSERT_EQUAL(g_state.scale_id_idx, 0);
}

static void test_cycle_scale_wrap_backward(void) {
    init_state();
    engine_cycle_scale(&g_state, -1);
    CU_ASSERT_EQUAL(g_state.scale_id_idx, NUM_SCALES - 1);
}

// ============ engine_cycle_scale_root ============

static void test_cycle_root_forward(void) {
    init_state();
    CU_ASSERT_EQUAL(g_state.scale_root, 0);
    engine_cycle_scale_root(&g_state, 1);
    CU_ASSERT_EQUAL(g_state.scale_root, 7); // C → G (circle of fifths)
}

// ============ get_arp_chord_index ============

static void test_arp_chord_returns_sentinel(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_CHORD, 3, 0, 0), 255);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_CHORD, 3, 5, 0), 255);
}

static void test_arp_single_note_returns_sentinel(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 1, 0, 0), 255);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN, 1, 0, 0), 255);
}

static void test_arp_up_cycles(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 0, 0), 0);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 1, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 2, 0), 2);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 3, 0), 0);
}

static void test_arp_down_cycles(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN, 3, 0, 0), 2);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN, 3, 1, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN, 3, 2, 0), 0);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN, 3, 3, 0), 2);
}

static void test_arp_up_down_bounces(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP_DOWN, 3, 0, 0), 0);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP_DOWN, 3, 1, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP_DOWN, 3, 2, 0), 2);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP_DOWN, 3, 3, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP_DOWN, 3, 4, 0), 0);
}

static void test_arp_down_up_bounces(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN_UP, 3, 0, 0), 2);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN_UP, 3, 1, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN_UP, 3, 2, 0), 0);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN_UP, 3, 3, 0), 1);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_DOWN_UP, 3, 4, 0), 2);
}

static void test_arp_offset_shifts(void) {
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 0, 1), 2);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 1, 1), 0);
    CU_ASSERT_EQUAL(get_arp_chord_index(ARP_UP, 3, 2, 1), 1);
}

// ============ is_arp_chord_active ============

static void test_arp_active_chord_always_true(void) {
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_CHORD, 3, 0, 0, 1, 0), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_CHORD, 3, 0, 0, 1, 2), 1);
}

static void test_arp_active_single_voice(void) {
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 0), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 1), 0);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 2), 0);
}

static void test_arp_active_multi_voice_window(void) {
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 0), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 1), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 2), 0);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 3), 0);
}

static void test_arp_active_all_voices(void) {
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 0), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 1), 1);
    CU_ASSERT_EQUAL(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 2), 1);
}

// ============ Voicings ============

static void test_voicing_count_valid(void) {
    CU_ASSERT(get_voicing_count(3, 2) > 0);
}

static void test_voicing_offsets_basic(void) {
    int8_t offsets[MAX_CHORD_SIZE];
    uint8_t count = get_voicing_offsets(3, 2, 0, offsets);
    CU_ASSERT(count > 0);
    CU_ASSERT_EQUAL(offsets[0], 0);
}

static void test_voicing_name_not_null(void) {
    const char* name = get_voicing_name(3, 2, 0);
    CU_ASSERT_PTR_NOT_NULL(name);
    CU_ASSERT(strlen(name) > 0);
}

// ============ Misc ============

static void test_scale_name_c_major(void) {
    init_state();
    CU_ASSERT_STRING_EQUAL(engine_get_scale_name_str(&g_state), "Major");
}

static void test_alloc_event_id_increments(void) {
    init_state();
    uint16_t id1 = engine_alloc_event_id(&g_state);
    uint16_t id2 = engine_alloc_event_id(&g_state);
    CU_ASSERT_EQUAL(id2, id1 + 1);
}

// ============ Suite registration ============

void register_core_tests(void) {
    CU_pSuite suite = CU_add_suite("engine_core", NULL, NULL);

    CU_add_test(suite, "init_defaults", test_init_defaults);
    CU_add_test(suite, "init_pattern_lengths", test_init_pattern_lengths);
    CU_add_test(suite, "init_queued_patterns_negative", test_init_queued_patterns_negative);

    CU_add_test(suite, "note_to_midi_c4", test_note_to_midi_c4);
    CU_add_test(suite, "note_to_midi_above", test_note_to_midi_above);
    CU_add_test(suite, "note_to_midi_below", test_note_to_midi_below);
    CU_add_test(suite, "note_to_midi_out_of_range", test_note_to_midi_out_of_range);

    CU_add_test(suite, "rebuild_scale_c_major", test_rebuild_scale_c_major);
    CU_add_test(suite, "rebuild_scale_chromatic", test_rebuild_scale_chromatic);
    CU_add_test(suite, "rebuild_scale_d_major", test_rebuild_scale_d_major);

    CU_add_test(suite, "cycle_scale_forward", test_cycle_scale_forward);
    CU_add_test(suite, "cycle_scale_wrap_forward", test_cycle_scale_wrap_forward);
    CU_add_test(suite, "cycle_scale_wrap_backward", test_cycle_scale_wrap_backward);
    CU_add_test(suite, "cycle_root_forward", test_cycle_root_forward);

    CU_add_test(suite, "arp_chord_returns_sentinel", test_arp_chord_returns_sentinel);
    CU_add_test(suite, "arp_single_note_returns_sentinel", test_arp_single_note_returns_sentinel);
    CU_add_test(suite, "arp_up_cycles", test_arp_up_cycles);
    CU_add_test(suite, "arp_down_cycles", test_arp_down_cycles);
    CU_add_test(suite, "arp_up_down_bounces", test_arp_up_down_bounces);
    CU_add_test(suite, "arp_down_up_bounces", test_arp_down_up_bounces);
    CU_add_test(suite, "arp_offset_shifts", test_arp_offset_shifts);

    CU_add_test(suite, "arp_active_chord_always_true", test_arp_active_chord_always_true);
    CU_add_test(suite, "arp_active_single_voice", test_arp_active_single_voice);
    CU_add_test(suite, "arp_active_multi_voice_window", test_arp_active_multi_voice_window);
    CU_add_test(suite, "arp_active_all_voices", test_arp_active_all_voices);

    CU_add_test(suite, "voicing_count_valid", test_voicing_count_valid);
    CU_add_test(suite, "voicing_offsets_basic", test_voicing_offsets_basic);
    CU_add_test(suite, "voicing_name_not_null", test_voicing_name_not_null);

    CU_add_test(suite, "scale_name_c_major", test_scale_name_c_major);
    CU_add_test(suite, "alloc_event_id_increments", test_alloc_event_id_increments);
}
