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

use core::sync::atomic::{AtomicU32, Ordering};

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

// SysEx manufacturer ID: 0x7D = "educational/development use" (no registration needed)
const SYSEX_MFR: u8 = 0x7D;

// ============ Tick State ============

static PIT_RELOAD: AtomicU32 = AtomicU32::new(0);

fn bpm_to_pit_reload(bpm: f32) -> u32 {
    (60_000_000.0 / (bpm * TICKS_PER_QUARTER as f32)) as u32
}

// ============ USB Static Storage ============

static EP_MEMORY: EndpointMemory<2048> = EndpointMemory::new();
static EP_STATE: EndpointState = EndpointState::max_endpoints();

// ============ SysEx Protocol ============
// All SysEx messages: F0 7D <cmd> [data...] F7
// The usb_midi layer handles F0/F7 framing; we only deal with the inner bytes.

mod protocol {
    pub const SYSEX_MFR: u8 = 0x7D;

    // Commands (browser → Teensy)
    pub const CMD_PLAY: u8 = 0x01;
    pub const CMD_STOP: u8 = 0x02;
    pub const CMD_SET_BPM: u8 = 0x03;       // + 4 bytes: BPM × 100 as u32 (avoids float encoding in 7-bit SysEx)
    pub const CMD_SET_SWING: u8 = 0x04;      // + 2 bytes: swing value (50-75)
    pub const CMD_SET_PATTERN: u8 = 0x05;    // + ch, pat
    pub const CMD_SET_MUTE: u8 = 0x06;       // + ch, muted
    pub const CMD_SET_SOLO: u8 = 0x07;       // + ch, soloed
    pub const CMD_BUTTON_PRESS: u8 = 0x10;   // + row, col, mods
    pub const CMD_KEY_ACTION: u8 = 0x11;     // + action_id
    pub const CMD_SET_ROW_OFFSET: u8 = 0x12; // + ch, offset×1000 as 2×7-bit
    pub const CMD_SET_CHANNEL_TYPES: u8 = 0x13; // + 6 bytes
    pub const CMD_SET_ZOOM: u8 = 0x14;       // + zoom as 3×7-bit
    pub const CMD_SET_CURRENT_CHANNEL: u8 = 0x15; // + ch
    pub const CMD_SET_UI_MODE: u8 = 0x16;    // + mode
    pub const CMD_SET_SELECTED_EVENT: u8 = 0x17; // + idx as 2×7-bit + sign
    pub const CMD_SET_MODIFY_SUB_MODE: u8 = 0x18; // + sm
    pub const CMD_CLEAR_PATTERN: u8 = 0x19;
    pub const CMD_ARROW_PRESS: u8 = 0x1A;   // + direction, mods
    pub const CMD_GET_STATE: u8 = 0x20;
    pub const CMD_REBOOT: u8 = 0x21;     // reboot into bootloader for flashing
    pub const CMD_PING: u8 = 0x7E;

    // Responses (Teensy → browser)
    pub const RSP_PONG: u8 = 0x7E;
    pub const RSP_TICK: u8 = 0x40;           // + 4 bytes: tick as 7-bit encoded
    pub const RSP_STATE: u8 = 0x41;          // + state dump

    // Encode i32 as 5 × 7-bit bytes (SysEx can only carry 0-127 per byte)
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

    pub fn decode_u16(data: &[u8]) -> u16 {
        if data.len() < 3 { return 0; }
        (data[0] as u16) | ((data[1] as u16) << 7) | ((data[2] as u16 & 0x03) << 14)
    }
}

// ============ Diagnostic Counters ============
static mut SYSEX_COUNT: u8 = 0;
static mut LAST_CMD: u8 = 0;
static mut LAST_READ_LEN: u8 = 0;

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

    bus_adapter.gpt_mut(gpt::Instance::Gpt0, |gpt_timer| {
        gpt_timer.stop();
        gpt_timer.clear_elapsed();
        gpt_timer.set_interrupt_enabled(true);
        gpt_timer.set_mode(gpt::Mode::Repeat);
        gpt_timer.set_load(10_000);
        gpt_timer.reset();
        gpt_timer.run();
    });

    let usb_bus: &'static UsbBusAllocator<BusAdapter> = {
        extern crate alloc;
        alloc::boxed::Box::leak(alloc::boxed::Box::new(UsbBusAllocator::new(bus_adapter)))
    };

    let mut usb_midi = MidiClass::new(usb_bus);

    // MIDI device — no device_class override needed (class is in interface descriptors)
    let mut usb_device = UsbDeviceBuilder::new(usb_bus, USB_VID_PID)
        .product(USB_PRODUCT)
        .device_class(0x00)      // Defined at interface level
        .device_sub_class(0x00)
        .device_protocol(0x00)
        .build();
    let mut usb_configured = false;

    // ---- Initialize Engine ----
    let mut state = EngineState::new_boxed();
    engine_core::engine_core_init(&mut state);
    state.bpm = DEFAULT_BPM;

    // ---- Configure PIT0 ----
    let reload = bpm_to_pit_reload(DEFAULT_BPM);
    PIT_RELOAD.store(reload, Ordering::Relaxed);
    pit0.set_load_timer_value(reload);

    let mut tick_counter: u32 = 0;
    let mut idle_counter: u32 = 0;
    let mut midi_rx_buf = [0u8; 64];
    // Persistent buffer to accumulate USB MIDI packets across reads
    // (SysEx messages can span multiple USB reads)
    let mut accum_buf = [0u8; 256];
    let mut accum_len: usize = 0;

    // ---- Main Loop ----
    loop {
        // 1. Poll USB
        if usb_device.poll(&mut [&mut usb_midi]) {
            if usb_device.state() == UsbDeviceState::Configured {
                if !usb_configured {
                    usb_device.bus().configure();
                }
                usb_configured = true;
            } else {
                usb_configured = false;
            }
        }

        // 2. Process sequencer tick
        if state.is_playing != 0 && pit0.is_elapsed() {
            pit0.clear_elapsed();

            let new_reload = bpm_to_pit_reload(state.bpm);
            let current_reload = PIT_RELOAD.load(Ordering::Relaxed);
            if new_reload != current_reload {
                PIT_RELOAD.store(new_reload, Ordering::Relaxed);
                pit0.set_load_timer_value(new_reload);
            }

            engine_core::engine_core_tick(&mut state);
            tick_counter = tick_counter.wrapping_add(1);

            // Blink LED every beat
            if tick_counter % (TICKS_PER_QUARTER as u32) == 0 {
                led.toggle();
            }

            // Send tick update via SysEx every 48 ticks (~10x per beat)
            if usb_configured && tick_counter % 48 == 0 {
                let mut tick_bytes = [0u8; 5];
                protocol::encode_i32(state.current_tick, &mut tick_bytes);
                let sysex_data = [
                    SYSEX_MFR,
                    protocol::RSP_TICK,
                    tick_bytes[0], tick_bytes[1], tick_bytes[2],
                    tick_bytes[3], tick_bytes[4],
                ];
                let _ = usb_midi.send_sysex(&sysex_data);
            }
        }

        // 3. Drain MIDI event queue → UART + USB MIDI
        while let Some(ev) = platform::arm_platform::dequeue_midi() {
            match ev.kind {
                0 => {
                    // Note On → UART
                    let _ = nb::block!(midi_uart.write(0x90 | (ev.channel & 0x0F)));
                    let _ = nb::block!(midi_uart.write(ev.note & 0x7F));
                    let _ = nb::block!(midi_uart.write(ev.velocity & 0x7F));
                    // Note On → USB MIDI
                    if usb_configured {
                        let _ = usb_midi.note_on(ev.channel, ev.note, ev.velocity);
                    }
                }
                1 => {
                    // Note Off → UART
                    let _ = nb::block!(midi_uart.write(0x80 | (ev.channel & 0x0F)));
                    let _ = nb::block!(midi_uart.write(ev.note & 0x7F));
                    let _ = nb::block!(midi_uart.write(0));
                    // Note Off → USB MIDI
                    if usb_configured {
                        let _ = usb_midi.note_off(ev.channel, ev.note);
                    }
                }
                _ => {}
            }
        }

        // 4. Read ALL pending USB MIDI packets, accumulate across reads
        if usb_configured {
            // Drain all available USB reads into accumulation buffer
            loop {
                let space = accum_buf.len() - accum_len;
                if space < 64 { break; } // prevent overflow
                match usb_midi.read(&mut midi_rx_buf) {
                    Ok(count) if count > 0 => {
                        unsafe { LAST_READ_LEN = count as u8; }
                        accum_buf[accum_len..accum_len + count]
                            .copy_from_slice(&midi_rx_buf[..count]);
                        accum_len += count;
                    }
                    _ => break,
                }
            }

            // Process complete SysEx messages from accumulated buffer
            if accum_len > 0 {
                let consumed = process_midi_input(
                    &accum_buf[..accum_len],
                    &mut state,
                    &mut pit0,
                    &usb_midi,
                );
                // Shift unconsumed bytes to front
                if consumed > 0 && consumed < accum_len {
                    accum_buf.copy_within(consumed..accum_len, 0);
                }
                accum_len -= consumed;
            }
        }

        // 5. Idle LED blink when not playing
        if state.is_playing == 0 {
            idle_counter = idle_counter.wrapping_add(1);
            if idle_counter % 200_000 == 0 {
                led.toggle();
            }
        }
    }
}

// ============ MIDI Input Processing ============

/// Process SysEx messages from accumulated USB MIDI data.
/// Returns number of bytes consumed (so caller can shift remainder).
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
            None => break, // incomplete SysEx — wait for more data
        };
        offset += consumed;

        if data_len < 2 { continue; }
        if data[0] != SYSEX_MFR { continue; }

        let cmd = data[1];
        unsafe { SYSEX_COUNT = SYSEX_COUNT.wrapping_add(1); LAST_CMD = cmd; }
        let payload = &data[2..data_len];

        match cmd {
            protocol::CMD_PING => {
                let off = (state.row_offsets[0] * 1000.0) as u16;
                let sc = state.scale_count;
                let szi = state.scale_zero_index;
                let (sx_cnt, last, last_rd) = unsafe { (SYSEX_COUNT, LAST_CMD, LAST_READ_LEN) };
                let sysex = [
                    SYSEX_MFR, protocol::RSP_PONG,
                    (off & 0x7F) as u8, ((off >> 7) & 0x7F) as u8,
                    (sc & 0x7F) as u8, ((sc >> 7) & 0x7F) as u8,
                    (szi & 0x7F) as u8, ((szi >> 7) & 0x7F) as u8,
                    sx_cnt, last, last_rd,
                    state.is_playing,
                ];
                let _ = midi.send_sysex(&sysex);
            }
            protocol::CMD_PLAY => {
                engine_core::engine_core_play_init(state);
                state.is_playing = 1;
                let reload = bpm_to_pit_reload(state.bpm);
                PIT_RELOAD.store(reload, Ordering::Relaxed);
                pit.set_load_timer_value(reload);
                pit.enable();
            }
            protocol::CMD_STOP => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                pit.disable();
            }
            protocol::CMD_SET_BPM => {
                if payload.len() >= 4 {
                    // BPM × 100 as u16, encoded in 7-bit
                    let bpm_x100 = (payload[0] as u16)
                        | ((payload[1] as u16) << 7)
                        | (((payload[2] & 0x03) as u16) << 14);
                    let bpm = bpm_x100 as f32 / 100.0;
                    if bpm >= 20.0 && bpm <= 300.0 {
                        state.bpm = bpm;
                    }
                }
            }
            protocol::CMD_SET_SWING => {
                if !payload.is_empty() {
                    let swing = payload[0] as i32;
                    state.swing = swing.clamp(50, 75);
                }
            }
            protocol::CMD_SET_PATTERN => {
                if payload.len() >= 2 {
                    let ch = payload[0];
                    let pat = payload[1];
                    if (ch as usize) < engine_core::NUM_CHANNELS && pat < 8 {
                        state.queued_patterns[ch as usize] = pat as i8;
                    }
                }
            }
            protocol::CMD_SET_MUTE => {
                if payload.len() >= 2 {
                    let ch = payload[0];
                    if (ch as usize) < engine_core::NUM_CHANNELS {
                        state.muted[ch as usize] = payload[1];
                    }
                }
            }
            protocol::CMD_SET_SOLO => {
                if payload.len() >= 2 {
                    let ch = payload[0];
                    if (ch as usize) < engine_core::NUM_CHANNELS {
                        state.soloed[ch as usize] = payload[1];
                    }
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
            protocol::CMD_SET_ROW_OFFSET => {
                if payload.len() >= 3 {
                    let ch = payload[0];
                    let val = (payload[1] as u16) | ((payload[2] as u16) << 7);
                    let offset = val as f32 / 1000.0;
                    if (ch as usize) < engine_core::NUM_CHANNELS {
                        state.row_offsets[ch as usize] = offset;
                        state.target_row_offsets[ch as usize] = offset;
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
                    let zoom = (payload[0] as i32)
                        | ((payload[1] as i32) << 7)
                        | ((payload[2] as i32 & 0x03) << 14);
                    state.zoom = zoom;
                }
            }
            protocol::CMD_SET_CURRENT_CHANNEL => {
                if !payload.is_empty() && (payload[0] as usize) < engine_core::NUM_CHANNELS {
                    state.current_channel = payload[0];
                }
            }
            protocol::CMD_SET_UI_MODE => {
                if !payload.is_empty() {
                    state.ui_mode = payload[0];
                }
            }
            protocol::CMD_SET_SELECTED_EVENT => {
                if payload.len() >= 3 {
                    let unsigned = (payload[0] as i16) | ((payload[1] as i16) << 7);
                    let idx = if payload[2] != 0 { -unsigned } else { unsigned };
                    state.selected_event_idx = idx;
                }
            }
            protocol::CMD_SET_MODIFY_SUB_MODE => {
                if !payload.is_empty() {
                    state.modify_sub_mode = payload[0];
                }
            }
            protocol::CMD_CLEAR_PATTERN => {
                arp3_engine::engine_edit::engine_clear_pattern(state);
            }
            protocol::CMD_ARROW_PRESS => {
                if payload.len() >= 2 {
                    arp3_engine::engine_input::engine_arrow_press(
                        state, payload[0], payload[1],
                    );
                }
            }
            protocol::CMD_REBOOT => {
                // Reboot into HalfKay bootloader for flashing
                // bkpt #251 is caught by the Teensy ROM bootloader
                unsafe { core::arch::asm!("bkpt #251"); }
            }
            protocol::CMD_GET_STATE => {
                // Send full state dump back to browser
                let bpm_x100 = (state.bpm * 100.0) as u16;
                let zoom = state.zoom as u16;
                let mut sysex = [0u8; 40];
                let mut i = 0;
                sysex[i] = SYSEX_MFR; i += 1;
                sysex[i] = protocol::RSP_STATE; i += 1;
                // is_playing
                sysex[i] = state.is_playing; i += 1;
                // bpm × 100 as 3×7-bit
                sysex[i] = (bpm_x100 & 0x7F) as u8; i += 1;
                sysex[i] = ((bpm_x100 >> 7) & 0x7F) as u8; i += 1;
                sysex[i] = ((bpm_x100 >> 14) & 0x03) as u8; i += 1;
                // swing
                sysex[i] = state.swing as u8; i += 1;
                // zoom as 3×7-bit
                sysex[i] = (zoom & 0x7F) as u8; i += 1;
                sysex[i] = ((zoom >> 7) & 0x7F) as u8; i += 1;
                sysex[i] = ((zoom >> 14) & 0x03) as u8; i += 1;
                // current channel
                sysex[i] = state.current_channel; i += 1;
                // channel types (6 bytes)
                for ch in 0..engine_core::NUM_CHANNELS {
                    sysex[i] = state.channel_types[ch]; i += 1;
                }
                // row offsets (6 × 2 bytes, offset×1000 as 2×7-bit)
                for ch in 0..engine_core::NUM_CHANNELS {
                    let off = (state.row_offsets[ch] * 1000.0) as u16;
                    sysex[i] = (off & 0x7F) as u8; i += 1;
                    sysex[i] = ((off >> 7) & 0x7F) as u8; i += 1;
                }
                let _ = midi.send_sysex(&sysex[..i]);
            }
            _ => {}
        }
    }
    offset
}
