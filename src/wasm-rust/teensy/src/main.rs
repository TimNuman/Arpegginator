//! Arp3 Teensy 4.1 Firmware
//!
//! USB MIDI device — appears in DAWs as "Arp3 Sequencer"
//! Control protocol uses SysEx (F0 7D ... F7) via Web MIDI from browser
//! Note output is standard MIDI — goes directly to Ableton/DAW
//! Also outputs on LPUART4 (pins 8/7) at 31250 baud for hardware MIDI

#![no_std]
#![no_main]

mod audio;
mod usb_midi;

use teensy4_bsp as bsp;
use teensy4_panic as _;

use bsp::board;
use bsp::hal::pit::Channel as PitChannel;
use bsp::interrupt;
use bsp::usbd::{BusAdapter, EndpointMemory, EndpointState, Speed, gpt};

use usb_device::bus::UsbBusAllocator;
use usb_device::device::{StringDescriptors, UsbDeviceBuilder, UsbDeviceState, UsbVidPid};


use arp3_engine::cell::Global;
use arp3_engine::engine_core::{self, EngineState, TICKS_PER_QUARTER};
use arp3_engine::platform;

use usb_midi::MidiClass;

// ============ Global Allocator ============

use embedded_alloc::LlffHeap as Heap;

#[global_allocator]
static HEAP: Heap = Heap::empty();

const HEAP_SIZE: usize = 256 * 1024;
static HEAP_MEM: Global<[u8; HEAP_SIZE]> = Global::new([0u8; HEAP_SIZE]);

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
    pub const CMD_GET_PERF: u8 = 0x22;
    pub const CMD_PING: u8 = 0x7E;

    pub const RSP_PONG: u8 = 0x7E;
    pub const RSP_TICK: u8 = 0x40;
    pub const RSP_STATE: u8 = 0x41;
    pub const RSP_PERF: u8 = 0x42;

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

// ============ Sequencer Tick Counter (PIT ISR) ============

use core::sync::atomic::{AtomicU32, Ordering};

/// Ticks elapsed but not yet processed. The PIT ISR increments; the main
/// loop drains. Counting in an interrupt (instead of polling `is_elapsed`,
/// which is a single flag) means a long main-loop pass — UART bursts, USB
/// work, grid recompute — delays ticks instead of silently losing them: the
/// loop catches up on the next pass and the transport doesn't drift.
static PENDING_TICKS: AtomicU32 = AtomicU32::new(0);

/// Upper bound on catch-up per main-loop pass, so a huge backlog (e.g.
/// after a debugger halt) drains over several passes instead of wedging one.
const MAX_TICK_CATCHUP: u32 = 24;

/// Worst main-loop pass since the last CMD_GET_PERF, in DWT cycles. A pass
/// is the tick/MIDI service jitter window, so this is the number to watch
/// alongside the audio ISR max when checking timing on hardware. Written
/// and read only from the main loop; atomic just to live in a static.
static LOOP_MAX_CYCLES: AtomicU32 = AtomicU32::new(0);

#[bsp::rt::interrupt]
fn PIT() {
    // Only channel 0's interrupt is ever enabled; clear its flag and count.
    let pit = unsafe { bsp::ral::pit::PIT::instance() };
    bsp::ral::write_reg!(bsp::ral::pit::timer, &pit.TIMER[0], TFLG, TIF: 1);
    PENDING_TICKS.fetch_add(1, Ordering::Relaxed);
}

// ============ UART TX Ring (non-blocking hardware MIDI out) ============

/// Software TX buffer in front of the LPUART FIFO. Blocking writes at 31250
/// baud cost 320us/byte once the shallow hardware FIFO fills — a chord burst
/// across channels could stall the main loop for milliseconds, delaying
/// sequencer ticks. Bytes queue here instead, and `drain` moves them into
/// the FIFO with non-blocking writes on every main-loop pass. 512 bytes is
/// ~160ms of MIDI at full wire rate; a full ring drops the whole message so
/// the byte stream can't tear mid-message.
struct MidiTxRing {
    buf: [u8; 512],
    write: usize,
    read: usize,
}

impl MidiTxRing {
    const fn new() -> Self {
        MidiTxRing { buf: [0; 512], write: 0, read: 0 }
    }

    fn free(&self) -> usize {
        self.buf.len() - 1 - (self.write + self.buf.len() - self.read) % self.buf.len()
    }

    /// Queue a complete MIDI message; dropped whole if the ring is full.
    fn push(&mut self, msg: &[u8]) {
        if self.free() < msg.len() {
            return;
        }
        for &b in msg {
            self.buf[self.write] = b;
            self.write = (self.write + 1) % self.buf.len();
        }
    }

    /// Move queued bytes into the UART FIFO; stops as soon as it's full.
    fn drain(&mut self, uart: &mut board::Lpuart) {
        while self.read != self.write {
            if !uart.try_write(self.buf[self.read]) {
                break;
            }
            self.read = (self.read + 1) % self.buf.len();
        }
    }
}

// ============ USB MIDI TX Ring (coalesced, retried note events) ============

/// Queued 4-byte USB MIDI event packets. One bulk write per note event
/// meant that once the endpoint held an unsent packet, every further event
/// in the same burst hit WouldBlock and was silently dropped — dense chords
/// and flams lost notes. Events queue here instead; `flush` coalesces up to
/// 16 of them into one 64-byte bulk transfer and leaves them queued when
/// the endpoint is busy, retrying next pass.
struct UsbTxRing {
    buf: [[u8; 4]; 128],
    write: usize,
    read: usize,
}

impl UsbTxRing {
    const fn new() -> Self {
        UsbTxRing { buf: [[0; 4]; 128], write: 0, read: 0 }
    }

    /// Queue one event packet; dropped if the ring is full.
    fn push(&mut self, pkt: [u8; 4]) {
        let next = (self.write + 1) % self.buf.len();
        if next == self.read {
            return;
        }
        self.buf[self.write] = pkt;
        self.write = next;
    }

    fn clear(&mut self) {
        self.read = self.write;
    }

    /// Send queued packets, up to 16 per bulk transfer. Stops (keeping the
    /// rest queued) as soon as the endpoint reports busy.
    fn flush<B: usb_device::bus::UsbBus>(&mut self, usb: &MidiClass<B>) {
        while self.read != self.write {
            let mut out = [0u8; 64];
            let mut n = 0;
            let mut r = self.read;
            while r != self.write && n < 16 {
                out[n * 4..n * 4 + 4].copy_from_slice(&self.buf[r]);
                r = (r + 1) % self.buf.len();
                n += 1;
            }
            if usb.write_packets(&out[..n * 4]).is_err() {
                break;
            }
            self.read = r;
        }
    }
}

// ============ MIDI Output Helper ============

struct MidiOut<'a> {
    uart: &'a mut MidiTxRing,
    usb: &'a mut UsbTxRing,
    usb_ok: bool,
}

impl MidiOut<'_> {
    fn note_on(&mut self, ch: u8, note: u8, vel: u8) {
        self.uart.push(&[0x90 | (ch & 0x0F), note & 0x7F, vel & 0x7F]);
        if self.usb_ok {
            self.usb.push(usb_midi::note_on_packet(ch, note, vel));
        }
    }

    fn note_off(&mut self, ch: u8, note: u8) {
        self.uart.push(&[0x80 | (ch & 0x0F), note & 0x7F, 0]);
        if self.usb_ok {
            self.usb.push(usb_midi::note_off_packet(ch, note));
        }
    }
}

// ============ Entry Point ============

#[bsp::rt::entry]
fn main() -> ! {
    unsafe { HEAP.init(HEAP_MEM.as_ptr() as usize, HEAP_SIZE); }

    let board::Resources {
        mut gpio2,
        pins,
        mut pit,
        lpuart4,
        usb,
        mut ccm,
        ccm_analog,
        ..
    } = board::t41(board::instances());

    // PIT channel used for the sequencer tick timer.
    const PIT_CH: PitChannel = PitChannel::Chan0;

    let led = gpio2.output(pins.p13).ok().unwrap();

    // ---- MIDI UART (LPUART4 on pins 8/7) at 31250 baud ----
    let mut midi_uart: board::Lpuart = board::lpuart(lpuart4, pins.p8, pins.p7, 31250);

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
        .strings(&[StringDescriptors::default().product(USB_PRODUCT)])
        .unwrap()
        .device_class(0x00)
        .device_sub_class(0x00)
        .device_protocol(0x00)
        .build();
    let mut usb_configured = false;

    // ---- Initialize Engine ----
    let mut state = EngineState::new_boxed();
    engine_core::engine_core_init(&mut state);
    state.bpm = DEFAULT_BPM;

    // Enable the DWT cycle counter first: preview note-off timing, grid
    // refresh pacing, and the audio ISR's duration instrumentation all read
    // it, and the SAI interrupt starts inside audio::init below.
    unsafe {
        let dcb = &*cortex_m::peripheral::DCB::PTR;
        let dwt = &*cortex_m::peripheral::DWT::PTR;
        dcb.demcr.modify(|r| r | (1 << 24));
        dwt.cyccnt.write(0);
        dwt.ctrl.modify(|r| r | 1);
    }

    // ---- Internal synth on MQS (pins 10/12) ----
    let iomuxc_gpr = unsafe { bsp::ral::iomuxc_gpr::IOMUXC_GPR::instance() };
    audio::init(&mut ccm, &ccm_analog, &iomuxc_gpr, pins.p10, pins.p12);
    audio::sync_patches(&state);

    // ---- Configure PIT0 ----
    let mut pit_reload = bpm_to_pit_reload(DEFAULT_BPM);
    pit.set_load_timer_value(PIT_CH, pit_reload);
    // The channel itself is only enabled while playing (CMD_PLAY/STOP);
    // its interrupt just counts ticks into PENDING_TICKS.
    pit.set_interrupt_enable(PIT_CH, true);
    unsafe {
        let mut cp = cortex_m::Peripherals::steal();
        // Audio must preempt everything else: SAI3_TX above PIT (i.MX RT
        // implements the top 4 priority bits; lower value = higher priority).
        cp.NVIC.set_priority(interrupt::SAI3_TX, 0x10);
        cp.NVIC.set_priority(interrupt::PIT, 0x80);
        cortex_m::peripheral::NVIC::unmask(interrupt::PIT);
    }

    let mut tick_counter: u32 = 0;

    // Preview notes: up to 8 simultaneous (chords), shared note-off deadline
    const MAX_PREVIEW: usize = 8;
    let mut preview_notes: [(u8, u8); MAX_PREVIEW] = [(0, 0); MAX_PREVIEW];
    let mut preview_count: usize = 0;
    let mut preview_off_at: u32 = 0;

    // Grid refresh pacing: recomputing every pass burned the whole idle
    // budget on 128 cells of float color math and made worst-case pass
    // latency (= tick/MIDI service jitter) worse. ~120Hz is beyond anything
    // LEDs or the eye need. Milliseconds are accumulated from cycle deltas
    // so the pulse animation gets a real timebase (it was frozen at 0.0).
    const GRID_INTERVAL_CYCLES: u32 = 5_000_000; // ~8.3ms at 600MHz
    const GRID_MS_WRAP: f32 = 1_100_000.0; // multiple of the pulse period
    let mut last_grid_cycles = dwt_cycles();
    let mut grid_ms: f32 = 0.0;

    let mut midi_rx_buf = [0u8; 64];
    let mut accum_buf = [0u8; 256];
    let mut accum_len: usize = 0;

    // MIDI out buffers here; drained non-blocking each loop pass
    let mut uart_tx = MidiTxRing::new();
    let mut usb_tx = UsbTxRing::new();

    // USB audio: one iso packet in flight (built once, retried until sent)
    let mut usb_audio_pkt = [0u8; usb_midi::AUDIO_PACKET_BYTES];
    let mut usb_audio_pending: usize = 0;

    // ---- Main Loop ----
    loop {
        let pass_start = dwt_cycles();

        // 1. Poll USB
        if usb_device.poll(&mut [&mut usb_midi]) {
            if usb_device.state() == UsbDeviceState::Configured {
                if !usb_configured {
                    usb_device.bus().configure();
                    // Iso TX endpoints need dQH MULT >= 1 (see usb_midi.rs)
                    usb_midi::fix_audio_qh_mult(usb_midi.audio_ep_index());
                }
                usb_configured = true;
            } else {
                usb_configured = false;
            }
        }

        // 1b. Stream synth audio to the host while it's recording. A packet
        // is built once and retried until the endpoint accepts it, so no
        // samples are lost when the endpoint is still busy.
        if usb_configured && usb_midi.audio_streaming() {
            if usb_audio_pending == 0 {
                usb_audio_pending = audio::fill_usb_packet(&mut usb_audio_pkt);
            }
            if usb_audio_pending > 0
                && usb_midi.write_audio(&usb_audio_pkt[..usb_audio_pending]).is_ok()
            {
                usb_audio_pending = 0;
            }
        } else {
            // Not streaming: drop any packet caught in flight so a stream
            // restart begins from fresh ring samples, not stale audio
            usb_audio_pending = 0;
        }

        // 2. Process sequencer ticks counted by the PIT ISR, catching up
        // (bounded) if a long pass backed several up.
        if state.is_playing != 0 && PENDING_TICKS.load(Ordering::Relaxed) > 0 {
            let new_reload = bpm_to_pit_reload(state.bpm);
            if new_reload != pit_reload {
                pit_reload = new_reload;
                pit.set_load_timer_value(PIT_CH, pit_reload);
            }

            let mut budget = MAX_TICK_CATCHUP;
            while budget > 0 && PENDING_TICKS.load(Ordering::Relaxed) > 0 {
                PENDING_TICKS.fetch_sub(1, Ordering::Relaxed);
                budget -= 1;

                engine_core::engine_core_tick(&mut state);
                tick_counter = tick_counter.wrapping_add(1);

                if tick_counter.is_multiple_of(TICKS_PER_QUARTER as u32) {
                    led.toggle();
                }

                // Send tick update via SysEx every 48 ticks (~10× per beat)
                if usb_configured && tick_counter.is_multiple_of(48) {
                    let mut tb = [0u8; 5];
                    protocol::encode_i32(state.current_tick, &mut tb);
                    let _ = usb_midi.send_sysex(&[
                        SYSEX_MFR, protocol::RSP_TICK,
                        tb[0], tb[1], tb[2], tb[3], tb[4],
                    ]);
                }
            }
        }

        // 3. Drain MIDI event queue → UART ring + USB ring
        {
            let mut midi = MidiOut { uart: &mut uart_tx, usb: &mut usb_tx, usb_ok: usb_configured };
            let mut new_preview_started = false;

            use platform::arm_platform::MidiEvent;
            // Melodic channels also play the internal MQS synth
            let is_melodic = |ch: u8| !state.is_drum_channel(ch as usize);
            while let Some(ev) = platform::arm_platform::dequeue_midi() {
                match ev.kind {
                    MidiEvent::KIND_NOTE_ON => {
                        midi.note_on(ev.channel, ev.note as u8, ev.velocity);
                        if is_melodic(ev.channel) {
                            audio::note_on(ev.channel, ev.note as u8, ev.velocity);
                        }
                    }
                    MidiEvent::KIND_NOTE_OFF => {
                        midi.note_off(ev.channel, ev.note as u8);
                        if is_melodic(ev.channel) {
                            audio::note_off(ev.channel, ev.note as u8);
                        }
                    }
                    MidiEvent::KIND_SOUND_PARAM => {
                        audio::sound_param(ev.channel, ev.note as u8, ev.length_ticks as i16);
                    }
                    MidiEvent::KIND_PREVIEW => {
                        // Kill old preview notes on first note of a new batch
                        if !new_preview_started && preview_count > 0 {
                            for &(ch, n) in &preview_notes[..preview_count] {
                                midi.note_off(ch, n);
                                audio::note_off(ch, n);
                            }
                            preview_count = 0;
                        }
                        new_preview_started = true;

                        let midi_note = engine_core::note_to_midi(ev.note, &state);
                        if midi_note >= 0 {
                            let note = midi_note as u8;
                            midi.note_on(ev.channel, note, ev.velocity);
                            if is_melodic(ev.channel) {
                                audio::note_on(ev.channel, note, ev.velocity);
                            }
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
                    for &(ch, note) in &preview_notes[..preview_count] {
                        midi.note_off(ch, note);
                        audio::note_off(ch, note);
                    }
                    preview_count = 0;
                }
            }
        }

        // 3b. Feed queued MIDI into the UART FIFO and the USB endpoint
        uart_tx.drain(&mut midi_uart);
        if usb_configured {
            usb_tx.flush(&usb_midi);
        } else {
            // Don't replay a disconnect-era backlog at the host later
            usb_tx.clear();
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
                    &accum_buf[..accum_len], &mut state, &mut pit, &usb_midi,
                );
                if consumed > 0 && consumed < accum_len {
                    accum_buf.copy_within(consumed..accum_len, 0);
                }
                accum_len -= consumed;
            }
        }

        // 5. Recompute grid at ~120Hz (button-press hit-testing refreshes
        // the rendered_notes cache itself, so staleness here only affects
        // LED output)
        let now = dwt_cycles();
        let delta = now.wrapping_sub(last_grid_cycles);
        if delta >= GRID_INTERVAL_CYCLES {
            last_grid_cycles = now;
            grid_ms += delta as f32 / 600_000.0;
            if grid_ms >= GRID_MS_WRAP {
                grid_ms -= GRID_MS_WRAP;
            }
            arp3_engine::engine_ui::engine_compute_grid(&mut state, grid_ms);
        }

        // 6. Record worst-case pass duration for CMD_GET_PERF
        let pass_cycles = dwt_cycles().wrapping_sub(pass_start);
        if pass_cycles > LOOP_MAX_CYCLES.load(Ordering::Relaxed) {
            LOOP_MAX_CYCLES.store(pass_cycles, Ordering::Relaxed);
        }
    }
}

fn dwt_cycles() -> u32 {
    unsafe { (*cortex_m::peripheral::DWT::PTR).cyccnt.read() }
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
    pit: &mut bsp::hal::pit::Pit,
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
                pit.set_load_timer_value(PitChannel::Chan0, bpm_to_pit_reload(state.bpm));
                PENDING_TICKS.store(0, Ordering::Relaxed);
                pit.enable(PitChannel::Chan0);
            }
            protocol::CMD_STOP => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                pit.disable(PitChannel::Chan0);
                PENDING_TICKS.store(0, Ordering::Relaxed);
                audio::all_notes_off();
            }
            protocol::CMD_RESET => {
                engine_core::engine_core_stop(state);
                state.is_playing = 0;
                state.current_tick = -1;
                state.resume_tick = -1;
                pit.disable(PitChannel::Chan0);
                PENDING_TICKS.store(0, Ordering::Relaxed);
                audio::all_notes_off();
            }
            protocol::CMD_SET_BPM => {
                if payload.len() >= 3 {
                    let bpm_x100 = (payload[0] as u16)
                        | ((payload[1] as u16) << 7)
                        | (((payload[2] & 0x03) as u16) << 14);
                    let bpm = bpm_x100 as f32 / 100.0;
                    if (20.0..=300.0).contains(&bpm) { state.bpm = bpm; }
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
                    state.zoom = ((payload[0] as i32)
                        | ((payload[1] as i32) << 7)
                        | ((payload[2] as i32 & 0x03) << 14))
                        .max(1);
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
            protocol::CMD_GET_PERF => {
                // Worst audio-ISR duration and worst main-loop pass (both in
                // 600MHz DWT cycles) since the last query; reading resets.
                let isr_max = audio::take_max_isr_cycles();
                let loop_max = LOOP_MAX_CYCLES.swap(0, Ordering::Relaxed);
                let mut sysex = [0u8; 12];
                sysex[0] = SYSEX_MFR;
                sysex[1] = protocol::RSP_PERF;
                let mut b = [0u8; 5];
                protocol::encode_i32(isr_max as i32, &mut b);
                sysex[2..7].copy_from_slice(&b);
                protocol::encode_i32(loop_max as i32, &mut b);
                sysex[7..12].copy_from_slice(&b);
                let _ = midi.send_sysex(&sysex);
            }
            protocol::CMD_REBOOT => {
                unsafe { core::arch::asm!("bkpt #251"); }
            }
            _ => {}
        }
    }
    offset
}
