// arp3-engine — shared sequencer engine library
// Compiles for wasm32-unknown-unknown (browser) and thumbv7em-none-eabihf (Teensy 4.1)

#![no_std]
#![allow(static_mut_refs)]

extern crate alloc;

pub mod engine_core;
pub mod engine_edit;
pub mod engine_ui;
pub mod engine_input;
pub mod platform;
pub mod oled_gfx;
pub mod oled_fonts_aa;
pub mod oled_display;
pub mod oled_screen;
pub mod engine_strip;
pub mod engine_drums;

#[cfg(test)]
mod test_core;
#[cfg(test)]
mod test_edit;
#[cfg(test)]
mod test_rendered;
