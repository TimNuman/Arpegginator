// usb_midi.rs — USB MIDI 1.0 + USB Audio 1.0 capture class
//
// A single USB audio function containing:
//   - MIDI streaming: bulk IN (note events + SysEx responses) and bulk OUT
//     (SysEx control commands)
//   - Audio streaming: isochronous IN carrying the internal synth's output
//     as 16-bit 44.1kHz stereo, so the device shows up as a sound input on
//     the host — no analog wiring needed to hear it
//
// Both streaming interfaces hang off the one AudioControl interface
// (bInCollection = 2), which is how the spec models a sound card with MIDI.
//
// USB MIDI spec: https://www.usb.org/sites/default/files/midi10.pdf
// USB Audio 1.0 spec: https://www.usb.org/sites/default/files/audio10.pdf

use usb_device::class_prelude::*;
use usb_device::endpoint::{IsochronousSynchronizationType, IsochronousUsageType};
use usb_device::Result;

use teensy4_bsp::ral;

/// Max stereo frames per isochronous packet. 44.1kHz needs 44 or 45 frames
/// per 1ms USB frame; the variable packet length is what carries our PLL4
/// clock rate to the host (asynchronous capture source).
pub const AUDIO_MAX_FRAMES: usize = 45;
/// Iso packet capacity in bytes (16-bit stereo = 4 bytes per frame).
pub const AUDIO_PACKET_BYTES: usize = AUDIO_MAX_FRAMES * 4;

// UAC1 terminal IDs inside the AudioControl interface
const TERMINAL_LINE_IN: u8 = 5; // synth output, presented as a line connector
const TERMINAL_USB_STREAM: u8 = 6; // USB streaming output terminal

// USB MIDI event packet Code Index Numbers (high nibble of byte 0)
const CIN_NOTE_OFF: u8 = 0x08;
const CIN_NOTE_ON: u8 = 0x09;
const CIN_SYSEX_START: u8 = 0x04;       // SysEx start or continue (3 bytes)
const CIN_SYSEX_END_1: u8 = 0x05;       // SysEx end with 1 byte
const CIN_SYSEX_END_2: u8 = 0x06;       // SysEx end with 2 bytes
const CIN_SYSEX_END_3: u8 = 0x07;       // SysEx end with 3 bytes

/// Build a Note On event packet for the host.
pub fn note_on_packet(channel: u8, note: u8, velocity: u8) -> [u8; 4] {
    [CIN_NOTE_ON, 0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]
}

/// Build a Note Off event packet for the host.
pub fn note_off_packet(channel: u8, note: u8) -> [u8; 4] {
    [CIN_NOTE_OFF, 0x80 | (channel & 0x0F), note & 0x7F, 0]
}

pub struct MidiClass<'a, B: UsbBus> {
    interface_ac: InterfaceNumber,
    interface_ms: InterfaceNumber,
    interface_as: InterfaceNumber,
    ep_in: EndpointIn<'a, B>,
    ep_out: EndpointOut<'a, B>,
    ep_audio_in: EndpointIn<'a, B>,
    /// AudioStreaming alt setting: 0 = idle, 1 = host is pulling audio
    audio_alt: u8,
}

impl<'a, B: UsbBus> MidiClass<'a, B> {
    pub fn new(alloc: &'a UsbBusAllocator<B>) -> Self {
        Self {
            interface_ac: alloc.interface(),
            interface_ms: alloc.interface(),
            interface_as: alloc.interface(),
            ep_in: alloc.bulk(64),
            ep_out: alloc.bulk(64),
            ep_audio_in: alloc.isochronous(
                IsochronousSynchronizationType::Asynchronous,
                IsochronousUsageType::Data,
                AUDIO_PACKET_BYTES as u16,
                1, // every frame
            ),
            audio_alt: 0,
        }
    }

    /// True while the host has selected the streaming alt setting.
    pub fn audio_streaming(&self) -> bool {
        self.audio_alt == 1
    }

    /// Write one isochronous audio packet (16-bit stereo LE frames).
    pub fn write_audio(&self, data: &[u8]) -> Result<usize> {
        self.ep_audio_in.write(data)
    }

    /// Hardware endpoint index of the audio IN endpoint (for the QH fix).
    pub fn audio_ep_index(&self) -> usize {
        self.ep_audio_in.address().index()
    }

    /// Write pre-built 4-byte USB MIDI event packets (up to 64 bytes = 16
    /// events per bulk transfer). Errors (endpoint busy) leave the data
    /// unsent so the caller can retry.
    pub fn write_packets(&self, data: &[u8]) -> Result<usize> {
        self.ep_in.write(data)
    }

    /// Send a SysEx message to the USB host.
    /// `data` should NOT include F0/F7 framing — this function adds them.
    pub fn send_sysex(&self, data: &[u8]) -> Result<()> {
        // USB MIDI packs SysEx into 4-byte packets:
        //   F0 + first 2 data bytes → CIN 0x04 [F0, d0, d1]
        //   middle 3 data bytes     → CIN 0x04 [d2, d3, d4]
        //   last 1-3 bytes + F7     → CIN 0x05/06/07

        let total_len = data.len() + 2; // +2 for F0 and F7
        let mut sysex = [0u8; 128]; // max SysEx we'll send
        if total_len > sysex.len() { return Ok(()); }

        sysex[0] = 0xF0;
        sysex[1..1 + data.len()].copy_from_slice(data);
        sysex[1 + data.len()] = 0xF7;

        let mut pos = 0;
        let mut buf = [0u8; 64]; // USB packet buffer (up to 16 MIDI packets)
        let mut buf_pos = 0;

        while pos < total_len {
            let remaining = total_len - pos;

            if remaining >= 3 && pos + 3 < total_len {
                // 3 bytes, not ending with F7 → CIN_SYSEX_START
                buf[buf_pos] = CIN_SYSEX_START;
                buf[buf_pos + 1] = sysex[pos];
                buf[buf_pos + 2] = sysex[pos + 1];
                buf[buf_pos + 3] = sysex[pos + 2];
                pos += 3;
            } else if remaining == 3 {
                // Last 3 bytes (ends with F7) → CIN_SYSEX_END_3
                buf[buf_pos] = CIN_SYSEX_END_3;
                buf[buf_pos + 1] = sysex[pos];
                buf[buf_pos + 2] = sysex[pos + 1];
                buf[buf_pos + 3] = sysex[pos + 2];
                pos += 3;
            } else if remaining == 2 {
                // Last 2 bytes → CIN_SYSEX_END_2
                buf[buf_pos] = CIN_SYSEX_END_2;
                buf[buf_pos + 1] = sysex[pos];
                buf[buf_pos + 2] = sysex[pos + 1];
                buf[buf_pos + 3] = 0;
                pos += 2;
            } else {
                // Last 1 byte (just F7) → CIN_SYSEX_END_1
                buf[buf_pos] = CIN_SYSEX_END_1;
                buf[buf_pos + 1] = sysex[pos];
                buf[buf_pos + 2] = 0;
                buf[buf_pos + 3] = 0;
                pos += 1;
            }

            buf_pos += 4;

            // Flush if buffer is full (16 packets × 4 bytes = 64)
            if buf_pos >= 64 {
                let _ = self.ep_in.write(&buf[..buf_pos]);
                buf_pos = 0;
            }
        }

        // Flush remaining
        if buf_pos > 0 {
            let _ = self.ep_in.write(&buf[..buf_pos]);
        }

        Ok(())
    }

    /// Read USB MIDI packets from the host. Returns number of bytes read.
    /// Caller should process 4-byte packets from the returned buffer.
    pub fn read(&self, buf: &mut [u8]) -> Result<usize> {
        self.ep_out.read(buf)
    }
}

impl<B: UsbBus> UsbClass<B> for MidiClass<'_, B> {
    fn get_configuration_descriptors(&self, writer: &mut DescriptorWriter) -> Result<()> {
        // ---- Audio Control Interface (required, minimal) ----
        writer.interface(
            self.interface_ac,
            0x01, // AUDIO
            0x01, // AUDIOCONTROL
            0x00,
        )?;

        // AC Interface Header (CS_INTERFACE, HEADER)
        // wTotalLength = header(10) + input terminal(12) + output terminal(9)
        writer.write(
            0x24, // CS_INTERFACE
            &[
                0x01,                            // HEADER
                0x00, 0x01,                      // bcdADC = 1.0
                0x1F, 0x00,                      // wTotalLength = 31
                0x02,                            // bInCollection = 2
                self.interface_ms.into(),         // baInterfaceNr[0]: MIDI
                self.interface_as.into(),         // baInterfaceNr[1]: audio
            ],
        )?;

        // Input Terminal: the synth, presented as a stereo line connector
        writer.write(
            0x24,
            &[
                0x02,             // INPUT_TERMINAL
                TERMINAL_LINE_IN, // bTerminalID
                0x03, 0x06,       // wTerminalType = 0x0603 Line connector
                0x00,             // bAssocTerminal
                0x02,             // bNrChannels = 2
                0x03, 0x00,       // wChannelConfig = left front | right front
                0x00,             // iChannelNames
                0x00,             // iTerminal
            ],
        )?;

        // Output Terminal: USB streaming toward the host
        writer.write(
            0x24,
            &[
                0x03,                // OUTPUT_TERMINAL
                TERMINAL_USB_STREAM, // bTerminalID
                0x01, 0x01,          // wTerminalType = 0x0101 USB streaming
                0x00,                // bAssocTerminal
                TERMINAL_LINE_IN,    // bSourceID
                0x00,                // iTerminal
            ],
        )?;

        // ---- MIDI Streaming Interface ----
        writer.interface(
            self.interface_ms,
            0x01, // AUDIO
            0x03, // MIDISTREAMING
            0x00,
        )?;

        // MS Interface Header (CS_INTERFACE, MS_HEADER)
        // wTotalLength = 7 + 6 + 6 + 9 + 9 + 5 + 5 = 47
        writer.write(
            0x24,
            &[
                0x01,       // MS_HEADER
                0x00, 0x01, // bcdMSC = 1.0
                0x41, 0x00, // wTotalLength = 65
            ],
        )?;

        // MIDI IN Jack (Embedded, ID=1) — receives from host
        writer.write(0x24, &[0x02, 0x01, 0x01, 0x00])?;

        // MIDI IN Jack (External, ID=2) — our device's physical input
        writer.write(0x24, &[0x02, 0x02, 0x02, 0x00])?;

        // MIDI OUT Jack (Embedded, ID=3) — sends to host, source = External IN Jack 2
        writer.write(0x24, &[0x03, 0x01, 0x03, 0x01, 0x02, 0x01, 0x00])?;

        // MIDI OUT Jack (External, ID=4) — our device's physical output, source = Embedded IN Jack 1
        writer.write(0x24, &[0x03, 0x02, 0x04, 0x01, 0x01, 0x01, 0x00])?;

        // ---- Bulk OUT Endpoint (host → device) ----
        writer.endpoint(&self.ep_out)?;

        // CS_ENDPOINT for Bulk OUT — associated with Embedded IN Jack 1
        writer.write(0x25, &[0x01, 0x01, 0x01])?;

        // ---- Bulk IN Endpoint (device → host) ----
        writer.endpoint(&self.ep_in)?;

        // CS_ENDPOINT for Bulk IN — associated with Embedded OUT Jack 3
        writer.write(0x25, &[0x01, 0x01, 0x03])?;

        // ---- Audio Streaming Interface ----
        // Alt 0: zero-bandwidth (idle); hosts select it when not recording
        writer.interface_alt(self.interface_as, 0, 0x01, 0x02, 0x00, None)?;
        // Alt 1: streaming
        writer.interface_alt(self.interface_as, 1, 0x01, 0x02, 0x00, None)?;

        // AS General (CS_INTERFACE): linked to the USB streaming terminal, PCM
        writer.write(0x24, &[0x01, TERMINAL_USB_STREAM, 0x01, 0x01, 0x00])?;

        // Format Type I: stereo, 2-byte subframes, 16 bits, one rate: 44100
        writer.write(
            0x24,
            &[0x02, 0x01, 0x02, 0x02, 0x10, 0x01, 0x44, 0xAC, 0x00],
        )?;

        // Standard iso endpoint descriptor in its 9-byte audio-class form:
        // endpoint_ex appends bRefresh and bSynchAddress (both 0) after the
        // usual 7 bytes and keeps bNumEndpoints bookkeeping correct
        writer.endpoint_ex(&self.ep_audio_in, |extra| {
            if extra.len() < 2 {
                return Err(UsbError::BufferOverflow);
            }
            extra[0] = 0x00; // bRefresh
            extra[1] = 0x00; // bSynchAddress
            Ok(2)
        })?;

        // CS_ENDPOINT General: no controls, no lock delay
        writer.write(0x25, &[0x01, 0x00, 0x00, 0x00, 0x00])?;

        Ok(())
    }

    fn get_alt_setting(&mut self, interface: InterfaceNumber) -> Option<u8> {
        if u8::from(interface) == u8::from(self.interface_as) {
            Some(self.audio_alt)
        } else {
            None
        }
    }

    fn set_alt_setting(&mut self, interface: InterfaceNumber, alternative: u8) -> bool {
        if u8::from(interface) == u8::from(self.interface_as) && alternative <= 1 {
            self.audio_alt = alternative;
            true
        } else {
            false
        }
    }

    fn reset(&mut self) {
        self.audio_alt = 0;
    }

    fn poll(&mut self) {}
}

// ============ Isochronous queue head fix ============

/// imxrt-usbd never programs the dQH MULT field, but this controller requires
/// MULT >= 1 on isochronous TX endpoints — with MULT = 0 the endpoint
/// transmits nothing (RM "Device Data Structures", dQH capabilities). Poke
/// MULT = 1 into the audio endpoint's queue head after each configuration.
///
/// The QH array base is ENDPTLISTADDR (the RAL names the shared register
/// ASYNCLISTADDR); QHs are 64 bytes each, ordered EP0 OUT, EP0 IN, EP1 OUT,
/// EP1 IN, … The QH memory is the `EndpointState` static in DTCM (uncached),
/// so a volatile read-modify-write is sufficient.
pub fn fix_audio_qh_mult(ep_index: usize) {
    const QH_SIZE: usize = 64;
    const MULT_SHIFT: u32 = 30;
    let usb1 = unsafe { ral::usb::USB1::instance() };
    let base = ral::read_reg!(ral::usb, usb1, ASYNCLISTADDR) as usize;
    if base == 0 {
        return;
    }
    let qh_capabilities = (base + (2 * ep_index + 1) * QH_SIZE) as *mut u32;
    unsafe {
        let v = qh_capabilities.read_volatile();
        qh_capabilities.write_volatile((v & !(0b11 << MULT_SHIFT)) | (0b01 << MULT_SHIFT));
    }
}

// ============ SysEx Parsing Helper ============

/// Extract SysEx data bytes from USB MIDI packets.
/// Returns (data_without_f0_f7, bytes_consumed) or None if incomplete.
pub fn parse_sysex_from_usb(buf: &[u8]) -> Option<([u8; 64], usize, usize)> {
    // buf contains raw USB MIDI 4-byte packets
    // Returns: (sysex_data, data_len, total_bytes_consumed)
    let mut data = [0u8; 64];
    let mut data_len = 0;
    let mut pos = 0;

    while pos + 4 <= buf.len() {
        let cin = buf[pos] & 0x0F;
        let b1 = buf[pos + 1];
        let b2 = buf[pos + 2];
        let b3 = buf[pos + 3];
        pos += 4;

        match cin {
            0x04 => {
                // SysEx start or continue — 3 data bytes
                // Skip F0 if it's the start
                let start = if b1 == 0xF0 { 1 } else { 0 };
                let bytes = [b1, b2, b3];
                for &b in &bytes[start..3] {
                    if b != 0xF7 && data_len < data.len() {
                        data[data_len] = b;
                        data_len += 1;
                    }
                }
            }
            0x05 => {
                // SysEx end — 1 byte (just F7)
                return Some((data, data_len, pos));
            }
            0x06 => {
                // SysEx end — 2 bytes (data + F7)
                if b1 != 0xF7 && data_len < data.len() {
                    data[data_len] = b1;
                    data_len += 1;
                }
                return Some((data, data_len, pos));
            }
            0x07 => {
                // SysEx end — 3 bytes (data + data + F7)
                if b1 != 0xF7 && data_len < data.len() {
                    data[data_len] = b1;
                    data_len += 1;
                }
                if b2 != 0xF7 && data_len < data.len() {
                    data[data_len] = b2;
                    data_len += 1;
                }
                return Some((data, data_len, pos));
            }
            _ => {
                // Non-SysEx packet (clock, notes, active sense, …). Drop it and
                // any partial SysEx, then keep scanning. The 4 bytes are already
                // consumed (pos advanced), so they get drained by the caller —
                // otherwise unparseable traffic would wedge the accumulator.
                data_len = 0;
            }
        }
    }

    if data_len == 0 && pos > 0 {
        // Only consumed non-SysEx packets, no SysEx in flight: report them drained.
        Some((data, 0, pos))
    } else {
        // data_len > 0: partial SysEx awaiting more packets.
        // pos == 0: fewer than 4 bytes buffered — incomplete packet.
        None
    }
}
