// usb_midi.rs — USB MIDI 1.0 class for usb-device 0.2
//
// Single-port USB MIDI device with:
//   - Bulk IN endpoint (device → host): note events + SysEx responses
//   - Bulk OUT endpoint (host → device): SysEx control commands
//
// USB MIDI spec: https://www.usb.org/sites/default/files/midi10.pdf

use usb_device::class_prelude::*;
use usb_device::Result;

// USB MIDI event packet Code Index Numbers (high nibble of byte 0)
const CIN_NOTE_OFF: u8 = 0x08;
const CIN_NOTE_ON: u8 = 0x09;
const CIN_SYSEX_START: u8 = 0x04;       // SysEx start or continue (3 bytes)
const CIN_SYSEX_END_1: u8 = 0x05;       // SysEx end with 1 byte
const CIN_SYSEX_END_2: u8 = 0x06;       // SysEx end with 2 bytes
const CIN_SYSEX_END_3: u8 = 0x07;       // SysEx end with 3 bytes

pub struct MidiClass<'a, B: UsbBus> {
    interface_ac: InterfaceNumber,
    interface_ms: InterfaceNumber,
    ep_in: EndpointIn<'a, B>,
    ep_out: EndpointOut<'a, B>,
}

impl<'a, B: UsbBus> MidiClass<'a, B> {
    pub fn new(alloc: &'a UsbBusAllocator<B>) -> Self {
        Self {
            interface_ac: alloc.interface(),
            interface_ms: alloc.interface(),
            ep_in: alloc.bulk(64),
            ep_out: alloc.bulk(64),
        }
    }

    /// Send a Note On event to the USB host
    pub fn note_on(&self, channel: u8, note: u8, velocity: u8) -> Result<usize> {
        let packet = [
            CIN_NOTE_ON,
            0x90 | (channel & 0x0F),
            note & 0x7F,
            velocity & 0x7F,
        ];
        self.ep_in.write(&packet)
    }

    /// Send a Note Off event to the USB host
    pub fn note_off(&self, channel: u8, note: u8) -> Result<usize> {
        let packet = [
            CIN_NOTE_OFF,
            0x80 | (channel & 0x0F),
            note & 0x7F,
            0,
        ];
        self.ep_in.write(&packet)
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
        writer.write(
            0x24, // CS_INTERFACE
            &[
                0x01,                            // HEADER
                0x00, 0x01,                      // bcdADC = 1.0
                0x09, 0x00,                      // wTotalLength = 9
                0x01,                            // bInCollection = 1
                self.interface_ms.into(),         // baInterfaceNr
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

        Ok(())
    }

    fn reset(&mut self) {}

    fn poll(&mut self) {}
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
                // Not SysEx — stop parsing
                return None;
            }
        }
    }

    None // Incomplete
}
