#ifndef ENGINE_H
#define ENGINE_H

#include <stdint.h>

// Proof-of-concept functions to verify the WASM toolchain works

int32_t engine_add(int32_t a, int32_t b);
int32_t engine_tick(int32_t current_tick, int32_t bpm);
void engine_init(int32_t initial_bpm);
int32_t engine_get_version(void);

#endif
