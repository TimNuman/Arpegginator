//! Arp3 Teensy 4.1 Firmware
//!
//! - PIT0: sequencer tick timer (480 PPQN, configurable BPM)
//! - LPUART4 (pins 8/7): hardware MIDI out at 31250 baud
//! - USB CDC-ACM serial: bidirectional control from web UI via WebSerial API

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use teensy4_bsp as bsp;
use teensy4_panic as _;

use bsp::board;
use bsp::hal::usbd::{BusAdapter, EndpointMemory, EndpointState, Speed, gpt};

use core::sync::atomic::{AtomicU32, Ordering};

use usb_device::bus::UsbBusAllocator;
use usb_device::device::{UsbDeviceBuilder, UsbDeviceState, UsbVidPid};
use usbd_serial::SerialPort;

use embedded_hal::serial::Write as SerialWrite;

use arp3_engine::engine_core::{self, EngineState, TICKS_PER_QUARTER};
use arp3_engine::platform;

// ============ Global Allocator ============

use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

const HEAP_SIZE: usize = 256 * 1024; // 256KB — EngineState is ~175KB
static mut HEAP_MEM: [u8; HEAP_SIZE] = [0u8; HEAP_SIZE];

// ============ Constants ============

const DEFAULT_BPM: f32 = 120.0;
const USB_VID_PID: UsbVidPid = UsbVidPid(0x16C0, 0x0483);
const USB_PRODUCT: &str = "Arp3 Sequencer";

// ============ Tick State ============

static PIT_RELOAD: AtomicU32 = AtomicU32::new(0);

fn bpm_to_pit_reload(bpm: f32) -> u32 {
    (60_000_000.0 / (bpm * TICKS_PER_QUARTER as f32)) as u32
}

// ============ USB Static Storage ============

static EP_MEMORY: EndpointMemory<2048> = EndpointMemory::new();
static EP_STATE: EndpointState = EndpointState::max_endpoints();

// ============ Serial Protocol ============

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
    pub const CMD_PING: u8 = 0xFE;
    pub const CMD_GET_STATE: u8 = 0xFF;

    pub const RSP_PONG: u8 = 0xFE;
    pub const RSP_TICK: u8 = 0x80;
    pub const RSP_STATE: u8 = 0x81;
}

// ============ Entry Point ============

#[bsp::rt::entry]
fn main() -> ! {
    // Initialize heap
    unsafe { HEAP.init(core::ptr::addr_of!(HEAP_MEM) as usize, HEAP_SIZE); }

    // Initialize BSP
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

    // ---- USB CDC-ACM Serial ----
    let bus_adapter = BusAdapter::with_speed(usb, &EP_MEMORY, &EP_STATE, Speed::LowFull);
    bus_adapter.set_interrupts(false);

    // Configure GPT timer for USB protocol timing
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
    let mut usb_serial = SerialPort::new(usb_bus);
    let mut usb_device = UsbDeviceBuilder::new(usb_bus, USB_VID_PID)
        .product(USB_PRODUCT)
        .device_class(usbd_serial::USB_CLASS_CDC)
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

    // ---- Buffers ----
    let mut serial_buf = [0u8; 256];
    let mut serial_buf_len: usize = 0;
    let mut tick_counter: u32 = 0;
    let mut idle_counter: u32 = 0;

    // ---- Main Loop ----
    loop {
        // 1. Poll USB frequently (required for enumeration)
        if usb_device.poll(&mut [&mut usb_serial]) {
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

            // Update PIT reload if BPM changed
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

            // Send tick update to USB host
            if usb_configured && tick_counter % 48 == 0 {
                let tick = state.current_tick;
                let msg = [
                    protocol::RSP_TICK,
                    (tick & 0xFF) as u8,
                    ((tick >> 8) & 0xFF) as u8,
                    ((tick >> 16) & 0xFF) as u8,
                    ((tick >> 24) & 0xFF) as u8,
                ];
                let _ = usb_serial.write(&msg);
            }
        }

        // 3. Drain MIDI event queue → UART
        while let Some(ev) = platform::arm_platform::dequeue_midi() {
            match ev.kind {
                0 => {
                    let _ = nb::block!(midi_uart.write(0x90 | (ev.channel & 0x0F)));
                    let _ = nb::block!(midi_uart.write(ev.note & 0x7F));
                    let _ = nb::block!(midi_uart.write(ev.velocity & 0x7F));
                }
                1 => {
                    let _ = nb::block!(midi_uart.write(0x80 | (ev.channel & 0x0F)));
                    let _ = nb::block!(midi_uart.write(ev.note & 0x7F));
                    let _ = nb::block!(midi_uart.write(0));
                }
                _ => {}
            }
        }

        // 4. Read USB serial commands
        if usb_configured {
            let mut buf = [0u8; 64];
            match usb_serial.read(&mut buf) {
                Ok(count) if count > 0 => {
                    let space = serial_buf.len() - serial_buf_len;
                    let to_copy = count.min(space);
                    serial_buf[serial_buf_len..serial_buf_len + to_copy]
                        .copy_from_slice(&buf[..to_copy]);
                    serial_buf_len += to_copy;

                    let consumed = process_serial_commands(
                        &serial_buf[..serial_buf_len],
                        &mut state,
                        &mut pit0,
                        &mut usb_serial,
                    );
                    let unconsumed = serial_buf_len - consumed;
                    if unconsumed > 0 {
                        serial_buf.copy_within(consumed..serial_buf_len, 0);
                    }
                    serial_buf_len = unconsumed;
                }
                _ => {}
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

// ============ Serial Command Processing ============

fn process_serial_commands<B: usb_device::bus::UsbBus>(
    buf: &[u8],
    state: &mut EngineState,
    pit: &mut bsp::hal::pit::Pit<0>,
    serial: &mut SerialPort<'static, B>,
) -> usize {
    let mut pos = 0;

    while pos < buf.len() {
        let remaining = buf.len() - pos;
        let cmd = buf[pos];

        match cmd {
            protocol::CMD_PING => {
                let _ = serial.write(&[protocol::RSP_PONG]);
                pos += 1;
            }
            protocol::CMD_PLAY => {
                engine_core::engine_core_play_init(state);
                state.is_playing = 1;
                let reload = bpm_to_pit_reload(state.bpm);
                PIT_RELOAD.store(reload, Ordering::Relaxed);
                pit.set_load_timer_value(reload);
                pit.enable();
                pos += 1;
            }
            protocol::CMD_STOP => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                pit.disable();
                pos += 1;
            }
            protocol::CMD_SET_BPM => {
                if remaining < 5 { break; }
                let bytes = [buf[pos+1], buf[pos+2], buf[pos+3], buf[pos+4]];
                let bpm = f32::from_le_bytes(bytes);
                if bpm >= 20.0 && bpm <= 300.0 {
                    state.bpm = bpm;
                }
                pos += 5;
            }
            protocol::CMD_SET_SWING => {
                if remaining < 5 { break; }
                let bytes = [buf[pos+1], buf[pos+2], buf[pos+3], buf[pos+4]];
                let swing = i32::from_le_bytes(bytes);
                state.swing = swing.clamp(50, 75);
                pos += 5;
            }
            protocol::CMD_SET_PATTERN => {
                if remaining < 3 { break; }
                let ch = buf[pos+1];
                let pat = buf[pos+2];
                if (ch as usize) < engine_core::NUM_CHANNELS && pat < 8 {
                    state.queued_patterns[ch as usize] = pat as i8;
                }
                pos += 3;
            }
            protocol::CMD_SET_MUTE => {
                if remaining < 3 { break; }
                let ch = buf[pos+1];
                let muted = buf[pos+2];
                if (ch as usize) < engine_core::NUM_CHANNELS {
                    state.muted[ch as usize] = muted;
                }
                pos += 3;
            }
            protocol::CMD_SET_SOLO => {
                if remaining < 3 { break; }
                let ch = buf[pos+1];
                let soloed = buf[pos+2];
                if (ch as usize) < engine_core::NUM_CHANNELS {
                    state.soloed[ch as usize] = soloed;
                }
                pos += 3;
            }
            protocol::CMD_BUTTON_PRESS => {
                if remaining < 4 { break; }
                let row = buf[pos+1];
                let col = buf[pos+2];
                let mods = buf[pos+3];
                arp3_engine::engine_input::engine_button_press(state, row, col, mods);
                pos += 4;
            }
            protocol::CMD_KEY_ACTION => {
                if remaining < 2 { break; }
                let action = buf[pos+1];
                arp3_engine::engine_input::engine_key_action(state, action);
                pos += 2;
            }
            protocol::CMD_GET_STATE => {
                send_state_dump(state, serial);
                pos += 1;
            }
            _ => {
                pos += 1;
            }
        }
    }

    pos
}

fn send_state_dump<B: usb_device::bus::UsbBus>(
    state: &EngineState,
    serial: &mut SerialPort<'static, B>,
) {
    let mut msg = [0u8; 32];
    msg[0] = protocol::RSP_STATE;
    msg[1] = state.is_playing;
    msg[2..6].copy_from_slice(&state.bpm.to_le_bytes());
    msg[6..10].copy_from_slice(&state.current_tick.to_le_bytes());
    msg[10..14].copy_from_slice(&state.swing.to_le_bytes());
    msg[14..20].copy_from_slice(&state.current_patterns);
    msg[20..26].copy_from_slice(&state.muted);
    msg[26..32].copy_from_slice(&state.soloed);
    let _ = serial.write(&msg);
}
