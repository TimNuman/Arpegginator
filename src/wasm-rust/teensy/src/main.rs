//! Arp3 Teensy 4.1 Firmware
//!
//! USB MIDI device — appears in DAWs as "Arp3 Sequencer"
//! Control protocol uses SysEx (F0 7D ... F7) via Web MIDI from browser
//! Note output is standard MIDI — goes directly to Ableton/DAW
//! Also outputs on LPUART4 (pins 8/7) at 31250 baud for hardware MIDI

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

mod usb_midi;

use teensy4_bsp as bsp;
use teensy4_panic as _;

use bsp::board;
use bsp::hal::usbd::{BusAdapter, EndpointMemory, EndpointState, Speed, gpt};

use usb_device::bus::UsbBusAllocator;
use usb_device::device::{UsbDeviceBuilder, UsbDeviceState, UsbVidPid};

use embedded_hal::serial::Write as SerialWrite;

use arp3_engine::engine_core::{self, EngineState, TICKS_PER_QUARTER};
use arp3_engine::platform;

use usb_midi::MidiClass;

// ============ Global Allocator ============

use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

const HEAP_SIZE: usize = 256 * 1024;
static mut HEAP_MEM: [u8; HEAP_SIZE] = [0u8; HEAP_SIZE];

// ============ Constants ============

const DEFAULT_BPM: f32 = 120.0;
const USB_VID_PID: UsbVidPid = UsbVidPid(0x16C0, 0x0483);
const USB_PRODUCT: &str = "Arp3 Sequencer";
const SYSEX_MFR: u8 = 0x7D;

// ============ SysEx Protocol ============

mod protocol {
    pub const CMD_PLAY: u8 = 0x01;
    pub const CMD_STOP: u8 = 0x02;
    pub const CMD_SET_BPM: u8 = 0x03;
    pub const CMD_SET_SWING: u8 = 0x04;
    pub const CMD_SET_PATTERN: u8 = 0x05;
    pub const CMD_SET_MUTE: u8 = 0x06;
    pub const CMD_SET_SOLO: u8 = 0x07;
    pub const CMD_BUTTON_PRESS: u8 = 0x10;
    pub const CMD_KEY_ACTION: u8 = 0x11;
    pub const CMD_SET_ROW_OFFSET: u8 = 0x12;
    pub const CMD_SET_CHANNEL_TYPES: u8 = 0x13;
    pub const CMD_SET_ZOOM: u8 = 0x14;
    pub const CMD_SET_CURRENT_CHANNEL: u8 = 0x15;
    pub const CMD_SET_UI_MODE: u8 = 0x16;
    pub const CMD_SET_SELECTED_EVENT: u8 = 0x17;
    pub const CMD_SET_MODIFY_SUB_MODE: u8 = 0x18;
    pub const CMD_CLEAR_PATTERN: u8 = 0x19;
    pub const CMD_ARROW_PRESS: u8 = 0x1A;
    pub const CMD_STRIP_START: u8 = 0x1B;
    pub const CMD_STRIP_MOVE: u8 = 0x1C;
    pub const CMD_STRIP_END: u8 = 0x1D;
    pub const CMD_RESET: u8 = 0x1E;
    pub const CMD_GET_STATE: u8 = 0x20;
    pub const CMD_REBOOT: u8 = 0x21;
    pub const CMD_PING: u8 = 0x7E;

    pub const RSP_PONG: u8 = 0x7E;
    pub const RSP_TICK: u8 = 0x40;
    pub const RSP_STATE: u8 = 0x41;

    pub fn encode_i32(val: i32, out: &mut [u8; 5]) {
        let v = val as u32;
        out[0] = (v & 0x7F) as u8;
        out[1] = ((v >> 7) & 0x7F) as u8;
        out[2] = ((v >> 14) & 0x7F) as u8;
        out[3] = ((v >> 21) & 0x7F) as u8;
        out[4] = ((v >> 28) & 0x0F) as u8;
    }

    pub fn decode_i32(data: &[u8]) -> i32 {
        if data.len() < 5 { return 0; }
        let v = (data[0] as u32)
            | ((data[1] as u32) << 7)
            | ((data[2] as u32) << 14)
            | ((data[3] as u32) << 21)
            | ((data[4] as u32) << 28);
        v as i32
    }
}

// ============ MIDI Output Helper ============

struct MidiOut<'a, B: usb_device::bus::UsbBus> {
    uart: &'a mut board::Lpuart4,
    usb: &'a MidiClass<'a, B>,
    usb_ok: bool,
}

impl<'a, B: usb_device::bus::UsbBus> MidiOut<'a, B> {
    fn note_on(&mut self, ch: u8, note: u8, vel: u8) {
        let _ = nb::block!(self.uart.write(0x90 | (ch & 0x0F)));
        let _ = nb::block!(self.uart.write(note & 0x7F));
        let _ = nb::block!(self.uart.write(vel & 0x7F));
        if self.usb_ok {
            let _ = self.usb.note_on(ch, note, vel);
        }
    }

    fn note_off(&mut self, ch: u8, note: u8) {
        let _ = nb::block!(self.uart.write(0x80 | (ch & 0x0F)));
        let _ = nb::block!(self.uart.write(note & 0x7F));
        let _ = nb::block!(self.uart.write(0));
        if self.usb_ok {
            let _ = self.usb.note_off(ch, note);
        }
    }
}

// ============ Entry Point ============

#[bsp::rt::entry]
fn main() -> ! {
    unsafe { HEAP.init(core::ptr::addr_of!(HEAP_MEM) as usize, HEAP_SIZE); }

    let board::Resources {
        mut gpio2,
        pins,
        pit: (mut pit0, ..),
        lpuart4,
        usb,
        ..
    } = board::t41(board::instances());

    let led = gpio2.output(pins.p13);

    // ---- MIDI UART (LPUART4 on pins 8/7) at 31250 baud ----
    let mut midi_uart: board::Lpuart4 = board::lpuart(lpuart4, pins.p8, pins.p7, 31250);

    // ---- USB MIDI Device ----
    let bus_adapter = BusAdapter::with_speed(usb, &EP_MEMORY, &EP_STATE, Speed::LowFull);
    bus_adapter.set_interrupts(false);
    bus_adapter.gpt_mut(gpt::Instance::Gpt0, |gpt| {
        gpt.stop();
        gpt.clear_elapsed();
        gpt.set_interrupt_enabled(true);
        gpt.set_mode(gpt::Mode::Repeat);
        gpt.set_load(10_000);
        gpt.reset();
        gpt.run();
    });

    let usb_bus: &'static UsbBusAllocator<BusAdapter> = {
        extern crate alloc;
        alloc::boxed::Box::leak(alloc::boxed::Box::new(UsbBusAllocator::new(bus_adapter)))
    };

    let mut usb_midi = MidiClass::new(usb_bus);
    let mut usb_device = UsbDeviceBuilder::new(usb_bus, USB_VID_PID)
        .product(USB_PRODUCT)
        .device_class(0x00)
        .device_sub_class(0x00)
        .device_protocol(0x00)
        .build();
    let mut usb_configured = false;

    // ---- Initialize Engine ----
    let mut state = EngineState::new_boxed();
    engine_core::engine_core_init(&mut state);
    state.bpm = DEFAULT_BPM;

    // ---- Configure PIT0 ----
    let mut pit_reload = bpm_to_pit_reload(DEFAULT_BPM);
    pit0.set_load_timer_value(pit_reload);

    let mut tick_counter: u32 = 0;

    // Preview notes: up to 8 simultaneous (chords), shared note-off deadline
    const MAX_PREVIEW: usize = 8;
    let mut preview_notes: [(u8, u8); MAX_PREVIEW] = [(0, 0); MAX_PREVIEW];
    let mut preview_count: usize = 0;
    let mut preview_off_at: u32 = 0;

    // Enable DWT cycle counter for preview note-off timing
    unsafe {
        let dcb = &*cortex_m::peripheral::DCB::PTR;
        let dwt = &*cortex_m::peripheral::DWT::PTR;
        dcb.demcr.modify(|r| r | (1 << 24));
        dwt.cyccnt.write(0);
        dwt.ctrl.modify(|r| r | 1);
    }

    let mut midi_rx_buf = [0u8; 64];
    let mut accum_buf = [0u8; 256];
    let mut accum_len: usize = 0;

    // ---- Main Loop ----
    loop {
        // 1. Poll USB
        if usb_device.poll(&mut [&mut usb_midi]) {
            if usb_device.state() == UsbDeviceState::Configured {
                if !usb_configured { usb_device.bus().configure(); }
                usb_configured = true;
            } else {
                usb_configured = false;
            }
        }

        // 2. Process sequencer tick
        if state.is_playing != 0 && pit0.is_elapsed() {
            pit0.clear_elapsed();

            let new_reload = bpm_to_pit_reload(state.bpm);
            if new_reload != pit_reload {
                pit_reload = new_reload;
                pit0.set_load_timer_value(pit_reload);
            }

            engine_core::engine_core_tick(&mut state);
            tick_counter = tick_counter.wrapping_add(1);

            if tick_counter % (TICKS_PER_QUARTER as u32) == 0 {
                led.toggle();
            }

            // Send tick update via SysEx every 48 ticks (~10× per beat)
            if usb_configured && tick_counter % 48 == 0 {
                let mut tb = [0u8; 5];
                protocol::encode_i32(state.current_tick, &mut tb);
                let _ = usb_midi.send_sysex(&[
                    SYSEX_MFR, protocol::RSP_TICK,
                    tb[0], tb[1], tb[2], tb[3], tb[4],
                ]);
            }
        }

        // 3. Drain MIDI event queue → UART + USB MIDI
        {
            let mut midi = MidiOut { uart: &mut midi_uart, usb: &usb_midi, usb_ok: usb_configured };
            let mut new_preview_started = false;

            while let Some(ev) = platform::arm_platform::dequeue_midi() {
                match ev.kind {
                    0 => midi.note_on(ev.channel, ev.note as u8, ev.velocity),
                    1 => midi.note_off(ev.channel, ev.note as u8),
                    2 => {
                        // Kill old preview notes on first note of a new batch
                        if !new_preview_started && preview_count > 0 {
                            for i in 0..preview_count {
                                let (ch, n) = preview_notes[i];
                                midi.note_off(ch, n);
                            }
                            preview_count = 0;
                        }
                        new_preview_started = true;

                        let midi_note = engine_core::note_to_midi(ev.note, &state);
                        if midi_note >= 0 {
                            let note = midi_note as u8;
                            midi.note_on(ev.channel, note, ev.velocity);
                            if preview_count < MAX_PREVIEW {
                                preview_notes[preview_count] = (ev.channel, note);
                                preview_count += 1;
                            }
                            // Schedule note-off: length_ticks → ms → DWT cycles
                            let ms = ev.length_ticks as f32 * 60_000.0
                                / (state.bpm * TICKS_PER_QUARTER as f32);
                            let cycles = (ms * 600_000.0) as u32;
                            let now = unsafe { (*cortex_m::peripheral::DWT::PTR).cyccnt.read() };
                            preview_off_at = now.wrapping_add(cycles);
                        }
                    }
                    _ => {}
                }
            }

            // Deferred preview note-off
            if preview_count > 0 {
                let now = unsafe { (*cortex_m::peripheral::DWT::PTR).cyccnt.read() };
                if now.wrapping_sub(preview_off_at) < 0x8000_0000 {
                    for i in 0..preview_count {
                        let (ch, note) = preview_notes[i];
                        midi.note_off(ch, note);
                    }
                    preview_count = 0;
                }
            }
        }

        // 4. Read USB MIDI packets, accumulate across reads for SysEx spanning multiple packets
        if usb_configured {
            loop {
                if accum_buf.len() - accum_len < 64 { break; }
                match usb_midi.read(&mut midi_rx_buf) {
                    Ok(count) if count > 0 => {
                        accum_buf[accum_len..accum_len + count]
                            .copy_from_slice(&midi_rx_buf[..count]);
                        accum_len += count;
                    }
                    _ => break,
                }
            }
            if accum_len > 0 {
                let consumed = process_midi_input(
                    &accum_buf[..accum_len], &mut state, &mut pit0, &usb_midi,
                );
                if consumed > 0 && consumed < accum_len {
                    accum_buf.copy_within(consumed..accum_len, 0);
                }
                accum_len -= consumed;
            }
        }

        // 5. Recompute grid (updates rendered_notes cache for button press hit-testing)
        arp3_engine::engine_ui::engine_compute_grid(&mut state, 0.0);
    }
}

// ============ Tick Helpers ============

fn bpm_to_pit_reload(bpm: f32) -> u32 {
    (60_000_000.0 / (bpm * TICKS_PER_QUARTER as f32)) as u32
}

static EP_MEMORY: EndpointMemory<2048> = EndpointMemory::new();
static EP_STATE: EndpointState = EndpointState::max_endpoints();

// ============ MIDI Input Processing ============

fn process_midi_input<B: usb_device::bus::UsbBus>(
    buf: &[u8],
    state: &mut EngineState,
    pit: &mut bsp::hal::pit::Pit<0>,
    midi: &MidiClass<B>,
) -> usize {
    let mut offset = 0;
    while offset < buf.len() {
        let remaining = &buf[offset..];
        let (data, data_len, consumed) = match usb_midi::parse_sysex_from_usb(remaining) {
            Some(r) => r,
            None => break,
        };
        offset += consumed;

        if data_len < 2 || data[0] != SYSEX_MFR { continue; }
        let cmd = data[1];
        let payload = &data[2..data_len];

        match cmd {
            protocol::CMD_PING => {
                let _ = midi.send_sysex(&[SYSEX_MFR, protocol::RSP_PONG, state.is_playing]);
            }
            protocol::CMD_PLAY => {
                let tick = if payload.len() >= 5 { protocol::decode_i32(payload) } else { 0 };
                if tick > 0 {
                    engine_core::engine_core_play_init_from_tick(state, tick);
                } else {
                    engine_core::engine_core_play_init(state);
                }
                state.is_playing = 1;
                pit.set_load_timer_value(bpm_to_pit_reload(state.bpm));
                pit.enable();
            }
            protocol::CMD_STOP => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                pit.disable();
            }
            protocol::CMD_RESET => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                state.current_tick = -1;
                state.resume_tick = -1;
                pit.disable();
            }
            protocol::CMD_SET_BPM => {
                if payload.len() >= 3 {
                    let bpm_x100 = (payload[0] as u16)
                        | ((payload[1] as u16) << 7)
                        | (((payload[2] & 0x03) as u16) << 14);
                    let bpm = bpm_x100 as f32 / 100.0;
                    if bpm >= 20.0 && bpm <= 300.0 { state.bpm = bpm; }
                }
            }
            protocol::CMD_SET_SWING => {
                if !payload.is_empty() {
                    state.swing = (payload[0] as i32).clamp(50, 75);
                }
            }
            protocol::CMD_SET_PATTERN => {
                if payload.len() >= 2 {
                    let (ch, pat) = (payload[0], payload[1]);
                    if (ch as usize) < engine_core::NUM_CHANNELS && pat < 8 {
                        state.queued_patterns[ch as usize] = pat as i8;
                    }
                }
            }
            protocol::CMD_SET_MUTE => {
                if payload.len() >= 2 && (payload[0] as usize) < engine_core::NUM_CHANNELS {
                    state.muted[payload[0] as usize] = payload[1];
                }
            }
            protocol::CMD_SET_SOLO => {
                if payload.len() >= 2 && (payload[0] as usize) < engine_core::NUM_CHANNELS {
                    state.soloed[payload[0] as usize] = payload[1];
                }
            }
            protocol::CMD_BUTTON_PRESS => {
                if payload.len() >= 3 {
                    arp3_engine::engine_input::engine_button_press(
                        state, payload[0], payload[1], payload[2],
                    );
                }
            }
            protocol::CMD_KEY_ACTION => {
                if !payload.is_empty() {
                    arp3_engine::engine_input::engine_key_action(state, payload[0]);
                }
            }
            protocol::CMD_ARROW_PRESS => {
                if payload.len() >= 2 {
                    arp3_engine::engine_input::engine_arrow_press(
                        state, payload[0], payload[1],
                    );
                }
            }
            protocol::CMD_SET_ROW_OFFSET => {
                if payload.len() >= 3 {
                    let ch = payload[0] as usize;
                    if ch < engine_core::NUM_CHANNELS {
                        let val = (payload[1] as u16) | ((payload[2] as u16) << 7);
                        let offset = val as f32 / 1000.0;
                        state.row_offsets[ch] = offset;
                        state.target_row_offsets[ch] = offset;
                    }
                }
            }
            protocol::CMD_SET_CHANNEL_TYPES => {
                for (i, &t) in payload.iter().enumerate().take(engine_core::NUM_CHANNELS) {
                    state.channel_types[i] = t;
                }
            }
            protocol::CMD_SET_ZOOM => {
                if payload.len() >= 3 {
                    state.zoom = (payload[0] as i32)
                        | ((payload[1] as i32) << 7)
                        | ((payload[2] as i32 & 0x03) << 14);
                }
            }
            protocol::CMD_SET_CURRENT_CHANNEL => {
                if !payload.is_empty() && (payload[0] as usize) < engine_core::NUM_CHANNELS {
                    state.current_channel = payload[0];
                }
            }
            protocol::CMD_SET_UI_MODE => {
                if !payload.is_empty() { state.ui_mode = payload[0]; }
            }
            protocol::CMD_SET_SELECTED_EVENT => {
                if payload.len() >= 3 {
                    let unsigned = (payload[0] as i16) | ((payload[1] as i16) << 7);
                    state.selected_event_idx = if payload[2] != 0 { -unsigned } else { unsigned };
                }
            }
            protocol::CMD_SET_MODIFY_SUB_MODE => {
                if !payload.is_empty() { state.modify_sub_mode = payload[0]; }
            }
            protocol::CMD_CLEAR_PATTERN => {
                arp3_engine::engine_edit::engine_clear_pattern(state);
            }
            protocol::CMD_STRIP_START => {
                if payload.len() >= 7 {
                    let strip = payload[0];
                    let pos = (payload[1] as i32) | ((payload[2] as i32) << 7);
                    let shift = payload[3];
                    let time = (payload[4] as u32) | ((payload[5] as u32) << 7) | ((payload[6] as u32) << 14);
                    arp3_engine::engine_strip::engine_strip_start(state, strip, pos, shift, time as f32);
                }
            }
            protocol::CMD_STRIP_MOVE => {
                if payload.len() >= 6 {
                    let strip = payload[0];
                    let pos = (payload[1] as i32) | ((payload[2] as i32) << 7);
                    let time = (payload[3] as u32) | ((payload[4] as u32) << 7) | ((payload[5] as u32) << 14);
                    arp3_engine::engine_strip::engine_strip_move(state, strip, pos, time as f32);
                }
            }
            protocol::CMD_STRIP_END => {
                if !payload.is_empty() {
                    arp3_engine::engine_strip::engine_strip_end(state, payload[0]);
                }
            }
            protocol::CMD_GET_STATE => {
                let bpm_x100 = (state.bpm * 100.0) as u16;
                let zoom = state.zoom as u16;
                let mut sysex = [0u8; 40];
                let mut i = 0;
                sysex[i] = SYSEX_MFR; i += 1;
                sysex[i] = protocol::RSP_STATE; i += 1;
                sysex[i] = state.is_playing; i += 1;
                sysex[i] = (bpm_x100 & 0x7F) as u8; i += 1;
                sysex[i] = ((bpm_x100 >> 7) & 0x7F) as u8; i += 1;
                sysex[i] = ((bpm_x100 >> 14) & 0x03) as u8; i += 1;
                sysex[i] = state.swing as u8; i += 1;
                sysex[i] = (zoom & 0x7F) as u8; i += 1;
                sysex[i] = ((zoom >> 7) & 0x7F) as u8; i += 1;
                sysex[i] = ((zoom >> 14) & 0x03) as u8; i += 1;
                sysex[i] = state.current_channel; i += 1;
                for ch in 0..engine_core::NUM_CHANNELS {
                    sysex[i] = state.channel_types[ch]; i += 1;
                }
                for ch in 0..engine_core::NUM_CHANNELS {
                    let off = (state.row_offsets[ch] * 1000.0) as u16;
                    sysex[i] = (off & 0x7F) as u8; i += 1;
                    sysex[i] = ((off >> 7) & 0x7F) as u8; i += 1;
                }
                let _ = midi.send_sysex(&sysex[..i]);
            }
            protocol::CMD_REBOOT => {
                unsafe { core::arch::asm!("bkpt #251"); }
            }
            _ => {}
        }
    }
    offset
}
