// test_oled.c — Tests for oled_screen.c static string helpers
// We #include the .c file directly to access static functions.

#include "test_framework.h"
#include "../engine_core.h"
#include <string.h>

extern EngineState g_state;

// Include oled_screen.c to access its static functions
#include "../oled_screen.c"

// ============ Helper ============

static void init_state_oled(void) {
    memset(&g_state, 0, sizeof(g_state));
    engine_core_init(&g_state);
}

// ============ midi_note_to_name ============

static void test_midi_note_c4(void) {
    char buf[8];
    midi_note_to_name(60, buf);
    CU_ASSERT_STRING_EQUAL(buf, "C4");
}

static void test_midi_note_a4(void) {
    char buf[8];
    midi_note_to_name(69, buf);
    CU_ASSERT_STRING_EQUAL(buf, "A4");
}

static void test_midi_note_c_neg1(void) {
    char buf[8];
    midi_note_to_name(0, buf);
    CU_ASSERT_STRING_EQUAL(buf, "C-1");
}

static void test_midi_note_g_sharp_5(void) {
    char buf[8];
    midi_note_to_name(80, buf);
    CU_ASSERT_STRING_EQUAL(buf, "G#5");
}

static void test_midi_note_highest(void) {
    char buf[8];
    midi_note_to_name(127, buf);
    CU_ASSERT_STRING_EQUAL(buf, "G9");
}

static void test_midi_note_invalid(void) {
    char buf[8];
    midi_note_to_name(-1, buf);
    CU_ASSERT_STRING_EQUAL(buf, "??");
}

// ============ tick_to_beat_display ============

static void test_beat_display_beat_1(void) {
    char buf[16];
    tick_to_beat_display(0, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1");
}

static void test_beat_display_beat_2(void) {
    char buf[16];
    tick_to_beat_display(480, buf);
    CU_ASSERT_STRING_EQUAL(buf, "2");
}

static void test_beat_display_subdivision(void) {
    char buf[16];
    tick_to_beat_display(120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1.2");
}

static void test_beat_display_third_sixteenth(void) {
    char buf[16];
    tick_to_beat_display(240, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1.3");
}

// ============ ticks_to_musical_name ============

static void test_musical_name_sixteenth(void) {
    char buf[16];
    ticks_to_musical_name(120, 120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/16");
}

static void test_musical_name_eighth(void) {
    char buf[16];
    ticks_to_musical_name(240, 120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "2/16");
}

static void test_musical_name_triplet(void) {
    char buf[16];
    ticks_to_musical_name(160, 120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/8T");
}

static void test_musical_name_quarter(void) {
    char buf[16];
    ticks_to_musical_name(480, 120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "4/16");
}

static void test_musical_name_fallback(void) {
    char buf[16];
    ticks_to_musical_name(17, 120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "17t");
}

// ============ ticks_to_canonical_name ============

static void test_canonical_sixteenth(void) {
    char buf[16];
    ticks_to_canonical_name(120, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/16");
}

static void test_canonical_quarter(void) {
    char buf[16];
    ticks_to_canonical_name(480, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/4");
}

static void test_canonical_half(void) {
    char buf[16];
    ticks_to_canonical_name(960, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/2");
}

static void test_canonical_whole(void) {
    char buf[16];
    ticks_to_canonical_name(1920, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1");
}

static void test_canonical_triplet(void) {
    char buf[16];
    ticks_to_canonical_name(160, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/8T");
}

static void test_canonical_two_quarters(void) {
    char buf[16];
    ticks_to_canonical_name(960, buf);
    CU_ASSERT_STRING_EQUAL(buf, "1/2");
}

static void test_canonical_fallback(void) {
    char buf[16];
    ticks_to_canonical_name(17, buf);
    CU_ASSERT_STRING_EQUAL(buf, "17t");
}

// ============ get_drum_name ============

static void test_drum_name_kick(void) {
    char buf[16];
    get_drum_name(36, buf);
    CU_ASSERT_STRING_EQUAL(buf, "Kick");
}

static void test_drum_name_snare(void) {
    char buf[16];
    get_drum_name(38, buf);
    CU_ASSERT_STRING_EQUAL(buf, "Snare");
}

static void test_drum_name_cl_hh(void) {
    char buf[16];
    get_drum_name(42, buf);
    CU_ASSERT_STRING_EQUAL(buf, "Cl HH");
}

static void test_drum_name_out_of_range(void) {
    char buf[16];
    get_drum_name(10, buf);
    CU_ASSERT_STRING_EQUAL(buf, "D10");
}

static void test_drum_name_boundary_low(void) {
    char buf[16];
    get_drum_name(35, buf);
    CU_ASSERT_STRING_EQUAL(buf, "Kick 2");
}

static void test_drum_name_boundary_high(void) {
    char buf[16];
    get_drum_name(81, buf);
    CU_ASSERT_STRING_EQUAL(buf, "Op Tri");
}

// ============ Suite registration ============

void register_oled_tests(void) {
    CU_pSuite suite = CU_add_suite("oled_screen", NULL, NULL);

    CU_add_test(suite, "midi_note_c4", test_midi_note_c4);
    CU_add_test(suite, "midi_note_a4", test_midi_note_a4);
    CU_add_test(suite, "midi_note_c_neg1", test_midi_note_c_neg1);
    CU_add_test(suite, "midi_note_g_sharp_5", test_midi_note_g_sharp_5);
    CU_add_test(suite, "midi_note_highest", test_midi_note_highest);
    CU_add_test(suite, "midi_note_invalid", test_midi_note_invalid);

    CU_add_test(suite, "beat_display_beat_1", test_beat_display_beat_1);
    CU_add_test(suite, "beat_display_beat_2", test_beat_display_beat_2);
    CU_add_test(suite, "beat_display_subdivision", test_beat_display_subdivision);
    CU_add_test(suite, "beat_display_third_sixteenth", test_beat_display_third_sixteenth);

    CU_add_test(suite, "musical_name_sixteenth", test_musical_name_sixteenth);
    CU_add_test(suite, "musical_name_eighth", test_musical_name_eighth);
    CU_add_test(suite, "musical_name_triplet", test_musical_name_triplet);
    CU_add_test(suite, "musical_name_quarter", test_musical_name_quarter);
    CU_add_test(suite, "musical_name_fallback", test_musical_name_fallback);

    CU_add_test(suite, "canonical_sixteenth", test_canonical_sixteenth);
    CU_add_test(suite, "canonical_quarter", test_canonical_quarter);
    CU_add_test(suite, "canonical_half", test_canonical_half);
    CU_add_test(suite, "canonical_whole", test_canonical_whole);
    CU_add_test(suite, "canonical_triplet", test_canonical_triplet);
    CU_add_test(suite, "canonical_two_quarters", test_canonical_two_quarters);
    CU_add_test(suite, "canonical_fallback", test_canonical_fallback);

    CU_add_test(suite, "drum_name_kick", test_drum_name_kick);
    CU_add_test(suite, "drum_name_snare", test_drum_name_snare);
    CU_add_test(suite, "drum_name_cl_hh", test_drum_name_cl_hh);
    CU_add_test(suite, "drum_name_out_of_range", test_drum_name_out_of_range);
    CU_add_test(suite, "drum_name_boundary_low", test_drum_name_boundary_low);
    CU_add_test(suite, "drum_name_boundary_high", test_drum_name_boundary_high);
}
