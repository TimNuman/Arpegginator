//! Arp3 Teensy 4.1 Firmware
//!
//! Runs the arp3 sequencer engine on Teensy 4.1 hardware.
//! Milestone 1: Initialize engine, blink LED to confirm life.

#![no_std]
#![no_main]

use teensy4_bsp as bsp;
use teensy4_panic as _;

use bsp::board;

// Global allocator for Box<EngineState> (~24KB)
use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

const HEAP_SIZE: usize = 64 * 1024; // 64KB heap — plenty for EngineState + headroom
static mut HEAP_MEM: [u8; HEAP_SIZE] = [0u8; HEAP_SIZE];

#[bsp::rt::entry]
fn main() -> ! {
    // Initialize heap allocator
    unsafe { HEAP.init(core::ptr::addr_of!(HEAP_MEM) as usize, HEAP_SIZE); }

    // Initialize BSP — provides pre-configured clock, pins, peripherals
    let board::Resources {
        mut gpio2,
        pins,
        pit: (mut pit0, _pit1, _pit2, _pit3),
        ..
    } = board::t41(board::instances());

    // LED on pin 13 (active high)
    let led = gpio2.output(pins.p13);

    // Initialize the sequencer engine
    let mut engine_state = arp3_engine::engine_core::EngineState::new_boxed();
    arp3_engine::engine_core::engine_core_init(&mut engine_state);

    // Configure PIT0 for a slow blink to prove we're alive
    // PIT clock = 1 MHz (board default after divide)
    pit0.set_load_timer_value(500_000); // 500ms
    pit0.enable();

    loop {
        // Wait for PIT0 to fire
        while !pit0.is_elapsed() {
            cortex_m::asm::wfi(); // sleep until interrupt
        }
        pit0.clear_elapsed();
        led.toggle();
    }
}
