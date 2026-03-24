// usb_midi.rs — Minimal USB MIDI 1.0 class for usb-device 0.2
//
// Implements a single-port USB MIDI device with one Bulk IN endpoint
// (device → host). Enough for the Teensy to appear as a MIDI source in DAWs.
//
// USB MIDI spec: https://www.usb.org/sites/default/files/midi10.pdf

use usb_device::class_prelude::*;
use usb_device::Result;

const USB_AUDIO_CLASS: u8 = 0x01;
const USB_AUDIO_SUBCLASS_CONTROL: u8 = 0x01;
const USB_MIDISTREAMING_SUBCLASS: u8 = 0x03;

// USB MIDI event packet (4 bytes)
// [cable_number << 4 | code_index, status, data1, data2]
const CIN_NOTE_ON: u8 = 0x09;
const CIN_NOTE_OFF: u8 = 0x08;

pub struct MidiClass<'a, B: UsbBus> {
    interface_ac: InterfaceNumber,
    interface_ms: InterfaceNumber,
    ep_in: EndpointIn<'a, B>,
}

impl<'a, B: UsbBus> MidiClass<'a, B> {
    pub fn new(alloc: &'a UsbBusAllocator<B>) -> Self {
        Self {
            interface_ac: alloc.interface(),
            interface_ms: alloc.interface(),
            ep_in: alloc.bulk(64),
        }
    }

    /// Send a Note On event to the USB host (DAW)
    pub fn note_on(&self, channel: u8, note: u8, velocity: u8) -> Result<usize> {
        let packet = [
            CIN_NOTE_ON,                     // Cable 0, CIN = Note On
            0x90 | (channel & 0x0F),          // MIDI status
            note & 0x7F,
            velocity & 0x7F,
        ];
        self.ep_in.write(&packet)
    }

    /// Send a Note Off event to the USB host (DAW)
    pub fn note_off(&self, channel: u8, note: u8) -> Result<usize> {
        let packet = [
            CIN_NOTE_OFF,                    // Cable 0, CIN = Note Off
            0x80 | (channel & 0x0F),
            note & 0x7F,
            0,
        ];
        self.ep_in.write(&packet)
    }
}

impl<B: UsbBus> UsbClass<B> for MidiClass<'_, B> {
    fn get_configuration_descriptors(&self, writer: &mut DescriptorWriter) -> Result<()> {
        // ---- Audio Control Interface (required by spec, minimal) ----
        writer.interface(
            self.interface_ac,
            USB_AUDIO_CLASS,
            USB_AUDIO_SUBCLASS_CONTROL,
            0x00,
        )?;

        // AC Interface Header descriptor (CS_INTERFACE, HEADER)
        writer.write(
            0x24, // CS_INTERFACE
            &[
                0x01,                                    // HEADER subtype
                0x00, 0x01,                              // bcdADC = 1.0
                0x09, 0x00,                              // wTotalLength = 9
                0x01,                                    // bInCollection = 1
                self.interface_ms.into(),                 // baInterfaceNr = MS interface
            ],
        )?;

        // ---- MIDI Streaming Interface ----
        writer.interface(
            self.interface_ms,
            USB_AUDIO_CLASS,
            USB_MIDISTREAMING_SUBCLASS,
            0x00,
        )?;

        // MS Interface Header (CS_INTERFACE, MS_HEADER)
        writer.write(
            0x24,
            &[
                0x01,       // MS_HEADER
                0x00, 0x01, // bcdMSC = 1.0
                0x25, 0x00, // wTotalLength = 37 (header + in_jack + out_jack + ep + ep_desc)
            ],
        )?;

        // MIDI IN Jack (Embedded) — represents our device's MIDI output
        writer.write(
            0x24,
            &[
                0x02, // MIDI_IN_JACK
                0x01, // EMBEDDED
                0x01, // bJackID = 1
                0x00, // iJack
            ],
        )?;

        // MIDI OUT Jack (External) — how host sees our output
        writer.write(
            0x24,
            &[
                0x03, // MIDI_OUT_JACK
                0x02, // EXTERNAL
                0x02, // bJackID = 2
                0x01, // bNrInputPins = 1
                0x01, // baSourceID = Jack 1 (Embedded IN)
                0x01, // baSourcePin = 1
                0x00, // iJack
            ],
        )?;

        // Bulk IN Endpoint (device → host)
        writer.endpoint(&self.ep_in)?;

        // CS_ENDPOINT descriptor for the Bulk IN
        writer.write(
            0x25, // CS_ENDPOINT
            &[
                0x01, // MS_GENERAL
                0x01, // bNumEmbMIDIJack = 1
                0x01, // baAssocJackID = Jack 1
            ],
        )?;

        Ok(())
    }

    fn reset(&mut self) {}

    fn poll(&mut self) {}
}
