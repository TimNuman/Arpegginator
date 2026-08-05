//! MQS audio output — the internal synth on hardware, no codec required.
//!
//! Drives the i.MX RT1062's Medium Quality Sound block from SAI3: the same
//! `arp3-synth` DSP that runs in the browser AudioWorklet renders 16-bit
//! stereo PCM into the SAI3 TX FIFO, and the MQS block converts it to a
//! ~353kHz PWM stream on pins 10 (right) and 12 (left). A first-order RC
//! low-pass per pin (e.g. 1k + 10nF) into an amp or powered speakers is the
//! only external hardware needed.
//!
//! Clocking follows the Teensy Audio Library's MQS setup exactly:
//!   PLL4 (audio PLL) = 24MHz * 28.224 = 677.376 MHz
//!   SAI3_CLK_ROOT    = PLL4 / (4 * 15) = 11.2896 MHz  (= 256 * 44100)
//!   BCLK             = MCLK / 8        = 1.4112 MHz   (16-bit stereo frames)
//!   sample rate      = 44100 Hz exactly
//!
//! ## Execution model
//!
//! The SAI3_TX FIFO-watermark interrupt is the audio thread. It drains a
//! lock-free command queue (notes + patch params, pushed by the main loop),
//! renders the synth in 32-sample blocks, and tops the 32-word FIFO up past
//! the watermark (24, see init). At 44.1kHz stereo that's ~11k interrupts/s
//! doing mostly FIFO writes, with a synth render every eighth one — and
//! immune to long main-loop work (display, LEDs, USB).
//!
//! Safety model: `TX`/`SYNTH`/`RENDER` are written during `init()` before
//! the interrupt is unmasked, and are only touched from the ISR afterwards.
//! The main loop communicates exclusively through `CMD_QUEUE`, an SPSC ring
//! with acquire/release indices (same pattern as the MIDI event queue).

use teensy4_bsp as bsp;

use bsp::hal;
use bsp::interrupt;
use bsp::ral;

use hal::sai::{self, Interrupts, Packing, SaiConfig, Status};

use arp3_engine::cell::Global;
use arp3_synth::{Synth, MAX_BLOCK};

pub const SAMPLE_RATE: u32 = 44_100;

/// Mono samples rendered per synth call (still stereo-duplicated into the
/// FIFO). Must divide MAX_BLOCK.
const BLOCK: usize = 32;

/// Output scale: f32 [-1,1] → i16, with a hair of headroom under full scale.
const I16_SCALE: f32 = 32_000.0;

// ============ Command queue (main loop → audio ISR) ============

#[derive(Clone, Copy)]
pub struct AudioCmd {
    pub kind: u8,
    pub channel: u8,
    pub a: u8,
    pub b: i16,
}

impl AudioCmd {
    pub const KIND_NOTE_ON: u8 = 0; // a = midi note, b = velocity
    pub const KIND_NOTE_OFF: u8 = 1; // a = midi note
    pub const KIND_ALL_OFF: u8 = 2;
    pub const KIND_PARAM: u8 = 3; // a = param id, b = value

    const fn zero() -> Self {
        AudioCmd { kind: 0, channel: 0, a: 0, b: 0 }
    }
}

/// Sized for a full patch sync burst (4 channels x 17 params) plus headroom
/// for simultaneous chords.
const CMD_QUEUE_SIZE: usize = 256;

use core::sync::atomic::{AtomicUsize, Ordering};

static CMD_QUEUE: Global<[AudioCmd; CMD_QUEUE_SIZE]> =
    Global::new([AudioCmd::zero(); CMD_QUEUE_SIZE]);
static CMD_WRITE: AtomicUsize = AtomicUsize::new(0);
static CMD_READ: AtomicUsize = AtomicUsize::new(0);

/// Push a command from the main loop. Full queue drops the command (the
/// param sync that follows any hiccup restores consistency).
fn enqueue(cmd: AudioCmd) {
    let w = CMD_WRITE.load(Ordering::Relaxed);
    let next = (w + 1) % CMD_QUEUE_SIZE;
    if next != CMD_READ.load(Ordering::Acquire) {
        CMD_QUEUE.get_mut()[w] = cmd;
        CMD_WRITE.store(next, Ordering::Release);
    }
}

fn dequeue() -> Option<AudioCmd> {
    let r = CMD_READ.load(Ordering::Relaxed);
    if r == CMD_WRITE.load(Ordering::Acquire) {
        return None;
    }
    let cmd = CMD_QUEUE.get()[r];
    CMD_READ.store((r + 1) % CMD_QUEUE_SIZE, Ordering::Release);
    Some(cmd)
}

// ============ Public API (main loop side) ============

pub fn note_on(channel: u8, note: u8, velocity: u8) {
    enqueue(AudioCmd { kind: AudioCmd::KIND_NOTE_ON, channel, a: note, b: velocity as i16 });
}

pub fn note_off(channel: u8, note: u8) {
    enqueue(AudioCmd { kind: AudioCmd::KIND_NOTE_OFF, channel, a: note, b: 0 });
}

pub fn all_notes_off() {
    enqueue(AudioCmd { kind: AudioCmd::KIND_ALL_OFF, channel: 0, a: 0, b: 0 });
}

pub fn sound_param(channel: u8, param: u8, value: i16) {
    enqueue(AudioCmd { kind: AudioCmd::KIND_PARAM, channel, a: param, b: value });
}

/// Queue the full patch state of every melodic channel (engine → synth),
/// e.g. right after init so the synth starts from the engine's patches.
pub fn sync_patches(state: &arp3_engine::engine_core::EngineState) {
    for ch in 0..arp3_engine::engine_core::NUM_CHANNELS {
        if state.is_drum_channel(ch) {
            continue;
        }
        for param in 0..arp3_synth::patch::NUM_PARAMS {
            sound_param(ch as u8, param as u8, state.sound_patches[ch][param]);
        }
    }
}

// ============ USB audio tap (audio ISR → main loop → iso endpoint) ============

/// Mono sample ring feeding the USB audio capture stream. The SAI ISR is the
/// producer (same samples it sends to MQS); the main loop packetizes into the
/// isochronous endpoint. ~23ms capacity; while the host isn't streaming the
/// ring simply sits full and new samples are dropped.
const USB_RING_SIZE: usize = 1024;

static USB_RING: Global<[i16; USB_RING_SIZE]> = Global::new([0; USB_RING_SIZE]);
static USB_WRITE: AtomicUsize = AtomicUsize::new(0);
static USB_READ: AtomicUsize = AtomicUsize::new(0);

/// ISR side: drop-new when full.
fn usb_push(sample: i16) {
    let w = USB_WRITE.load(Ordering::Relaxed);
    let next = (w + 1) % USB_RING_SIZE;
    if next != USB_READ.load(Ordering::Acquire) {
        USB_RING.get_mut()[w] = sample;
        USB_WRITE.store(next, Ordering::Release);
    }
}

fn usb_available() -> usize {
    (USB_WRITE.load(Ordering::Acquire) + USB_RING_SIZE - USB_READ.load(Ordering::Relaxed))
        % USB_RING_SIZE
}

/// Fill one isochronous packet with pending samples as 16-bit stereo LE
/// frames (mono duplicated). Returns bytes written; 0 when nothing pending.
///
/// The variable frame count (up to 45) is what carries our PLL4-derived
/// 44.1kHz to the host — an asynchronous capture source in UAC1 terms. If
/// more than ~10ms is queued (typically right after the host starts
/// streaming into a full ring), old samples are dropped down to ~3ms so
/// monitoring latency stays low.
pub fn fill_usb_packet(buf: &mut [u8; crate::usb_midi::AUDIO_PACKET_BYTES]) -> usize {
    let mut avail = usb_available();
    if avail > 441 {
        let drop = avail - 132;
        USB_READ.store(
            (USB_READ.load(Ordering::Relaxed) + drop) % USB_RING_SIZE,
            Ordering::Release,
        );
        avail -= drop;
    }
    let frames = avail.min(crate::usb_midi::AUDIO_MAX_FRAMES);
    let ring = USB_RING.get();
    let mut r = USB_READ.load(Ordering::Relaxed);
    for f in 0..frames {
        let s = ring[r];
        r = (r + 1) % USB_RING_SIZE;
        let [lo, hi] = s.to_le_bytes();
        let o = f * 4;
        buf[o] = lo;
        buf[o + 1] = hi;
        buf[o + 2] = lo;
        buf[o + 3] = hi;
    }
    USB_READ.store(r, Ordering::Release);
    frames * 4
}

// ============ ISR-owned state ============

// SAFETY (for all three Globals): written once in `init()` before SAI3_TX is
// unmasked, then accessed only from the SAI3_TX handler.
static TX: Global<Option<sai::Tx>> = Global::new(None);
static SYNTH: Global<Synth> = Global::new(Synth::new());

struct RenderBuf {
    samples: [f32; MAX_BLOCK],
    /// Next unconsumed sample; == BLOCK forces a render on first use
    pos: usize,
}

static RENDER: Global<RenderBuf> = Global::new(RenderBuf { samples: [0.0; MAX_BLOCK], pos: BLOCK });

// ============ Initialization ============

/// Bring up PLL4, SAI3 and the MQS block, then start the FIFO-watermark
/// interrupt. `p10`/`p12` are consumed: they become MQS_RIGHT / MQS_LEFT.
pub fn init(
    ccm: &mut ral::ccm::CCM,
    ccm_analog: &ral::ccm_analog::CCM_ANALOG,
    iomuxc_gpr: &ral::iomuxc_gpr::IOMUXC_GPR,
    mut p10: bsp::pins::t41::P10,
    mut p12: bsp::pins::t41::P12,
) {
    // ---- 1. Audio PLL (PLL4) = 24MHz * (28 + 2240/10000) = 677.376 MHz ----
    // Mirrors the Teensy Audio Library's set_audioClock(28, 2240, 10000).
    ral::write_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO,
        BYPASS: 1, ENABLE: 1, POST_DIV_SELECT: 2, DIV_SELECT: 28);
    ral::write_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO_NUM, 2240);
    ral::write_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO_DENOM, 10000);
    ral::modify_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO, POWERDOWN: 0);
    while ral::read_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO, LOCK) == 0 {}
    // Post divider /1 (MISC2 audio div = 0b00)
    ral::modify_reg!(ral::ccm_analog, ccm_analog, MISC2, AUDIO_DIV_LSB: 0, AUDIO_DIV_MSB: 0);
    ral::modify_reg!(ral::ccm_analog, ccm_analog, PLL_AUDIO, BYPASS: 0);

    // ---- 2. SAI3 clock root: PLL4 / 4 / 15 = 11.2896 MHz (256 * fs) ----
    ral::modify_reg!(ral::ccm, ccm, CSCMR1, SAI3_CLK_SEL: 2); // PLL4
    ral::modify_reg!(ral::ccm, ccm, CS1CDR, SAI3_CLK_PRED: 3, SAI3_CLK_PODF: 14);

    // ---- 3. Clock gates: SAI3 + MQS ----
    hal::ccm::clock_gate::sai::<3>().set(ccm, hal::ccm::clock_gate::ON);
    // MQS gate is CCGR0 CG2 (no HAL locator for it)
    ral::modify_reg!(ral::ccm, ccm, CCGR0, |v| v | (0b11 << 4));

    // ---- 4. Route MCLK to the MQS block and enable it ----
    ral::modify_reg!(ral::iomuxc_gpr, iomuxc_gpr, GPR1,
        SAI3_MCLK_DIR: 1, SAI3_MCLK3_SEL: 0);
    // Reset pulse, then enable: 32x oversample, mclk divide-by-1
    ral::modify_reg!(ral::iomuxc_gpr, iomuxc_gpr, GPR2, MQS_SW_RST: 1);
    ral::modify_reg!(ral::iomuxc_gpr, iomuxc_gpr, GPR2,
        MQS_SW_RST: 0, MQS_EN: 1, MQS_OVERSAMPLE: 0, MQS_CLK_DIV: 0);

    // ---- 5. Pins 10/12 → ALT2 (MQS_RIGHT / MQS_LEFT) ----
    hal::iomuxc::alternate(&mut p10, 2);
    hal::iomuxc::alternate(&mut p12, 2);

    // ---- 6. SAI3 TX: I2S master, 16-bit stereo, BCLK = MCLK/8 ----
    // MQS taps the internal SAI3 signals, so no SAI pins are configured.
    let sai3 = unsafe { ral::sai::SAI3::instance() };
    let sai = sai::Sai::without_pins(sai3, 1, 0);
    // Raise the TX watermark from the default 16 to 24 (of 32 FIFO words).
    // The ISR renders a whole 32-sample block inline, and the deadline for
    // that render is however much FIFO is left when the interrupt fires:
    // watermark words / 2 words-per-frame / 44.1kHz. At 16 that's ~181us,
    // which a worst-case render (8 additive/FM voices + sampler voices) can
    // blow through; at 24 it's ~272us. Cost: the interrupt rate roughly
    // doubles (~11k/s), each service topping up fewer words.
    let mut sai_config = SaiConfig::i2s(sai::bclk_div(8));
    sai_config.tx_fifo_wm = 24;
    let (tx, _rx) = sai
        .split(16, 2, Packing::None, &sai_config)
        .expect("valid SAI config");
    let mut tx = tx.expect("tx channel");

    // Prefill so the first frames after enable aren't an underrun
    for _ in 0..12 {
        tx.write_frame_u16(tx.channel(), &[0, 0]);
    }

    tx.set_interrupts(Interrupts::FIFO_REQUEST);
    tx.set_enable(true);

    let synth = SYNTH.get_mut();
    *synth = Synth::new();
    synth.set_sample_rate(SAMPLE_RATE as f32);
    *TX.get_mut() = Some(tx);

    // From here on the ISR owns TX/SYNTH/RENDER
    unsafe { cortex_m::peripheral::NVIC::unmask(interrupt::SAI3_TX) };
}

// ============ Audio ISR ============

fn apply_cmd(synth: &mut Synth, cmd: AudioCmd) {
    match cmd.kind {
        AudioCmd::KIND_NOTE_ON => synth.note_on(cmd.channel, cmd.a, cmd.b as u8),
        AudioCmd::KIND_NOTE_OFF => synth.note_off(cmd.channel, cmd.a),
        AudioCmd::KIND_ALL_OFF => synth.all_notes_off(),
        AudioCmd::KIND_PARAM => synth.set_param(cmd.channel, cmd.a, cmd.b),
        _ => {}
    }
}

#[bsp::rt::interrupt]
fn SAI3_TX() {
    let Some(tx) = TX.get_mut().as_mut() else { return };
    let synth = SYNTH.get_mut();

    while let Some(cmd) = dequeue() {
        apply_cmd(synth, cmd);
    }

    // An underrun (FIFO error) leaves TX stopped on some configs — clear the
    // flag so audio recovers instead of going permanently silent.
    let status = tx.status();
    if status.contains(Status::FIFO_ERROR) {
        tx.clear_status(Status::FIFO_ERROR);
    }

    // Top the FIFO up until it rises above the watermark
    let render = RENDER.get_mut();
    let chan = tx.channel();
    while tx.status().contains(Status::FIFO_REQUEST) {
        if render.pos >= BLOCK {
            synth.render(&mut render.samples[..BLOCK]);
            render.pos = 0;
        }
        let s = (render.samples[render.pos] * I16_SCALE) as i32;
        render.pos += 1;
        let s = s.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        usb_push(s); // tap the same stream for USB audio capture
        let s = s as u16;
        tx.write_frame_u16(chan, &[s, s]);
    }
}
