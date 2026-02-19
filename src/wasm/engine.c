#include "engine.h"
#include <emscripten.h>

static int32_t g_bpm = 120;
static int32_t g_version = 1000; // 1.0.0

EMSCRIPTEN_KEEPALIVE
int32_t engine_add(int32_t a, int32_t b) {
    return a + b;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_tick(int32_t current_tick, int32_t bpm) {
    (void)bpm;
    return current_tick + 1;
}

EMSCRIPTEN_KEEPALIVE
void engine_init(int32_t initial_bpm) {
    g_bpm = initial_bpm;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_version(void) {
    return g_version;
}
