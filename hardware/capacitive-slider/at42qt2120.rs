//! AT42QT2120 Capacitive Touch Slider Driver
//!
//! Minimal driver for reading slider position over I2C on Teensy 4.1.
//! Designed to feed into the Arpegginator's existing strip engine.
//!
//! Usage:
//!   let mut slider = At42qt2120::new();
//!   slider.init(&mut i2c);
//!   // In main loop:
//!   if let Some(event) = slider.poll(&mut i2c) { ... }

/// I2C address (fixed for AT42QT2120)
const ADDR: u8 = 0x1C;

// Register map (relevant subset)
const REG_CHIP_ID: u8 = 0x00;
const REG_SLIDER_POS: u8 = 0x06;
const REG_DET_STATUS: u8 = 0x02;
const REG_KEY_STATUS_1: u8 = 0x03;
const REG_KEY_STATUS_2: u8 = 0x04;
const REG_SLIDER_CTRL: u8 = 0x0E;
const REG_KEY0_DTHR: u8 = 0x10;

const EXPECTED_CHIP_ID: u8 = 0x3E;

/// Events emitted by the slider driver, matching the strip engine protocol.
pub enum SliderEvent {
    /// Finger touched the slider at this position (0-1024)
    Start(i32),
    /// Finger moved to new position (0-1024)
    Move(i32),
    /// Finger lifted
    End,
}

/// Tracks slider state to emit start/move/end events.
pub struct At42qt2120 {
    was_touching: bool,
    last_pos: i32,
}

impl At42qt2120 {
    pub const fn new() -> Self {
        Self {
            was_touching: false,
            last_pos: 0,
        }
    }

    /// Initialize the AT42QT2120: verify chip ID and configure slider mode.
    /// Returns true on success, false if chip not found.
    pub fn init<I2C, E>(&self, i2c: &mut I2C) -> bool
    where
        I2C: embedded_hal::blocking::i2c::Write<Error = E>
            + embedded_hal::blocking::i2c::WriteRead<Error = E>,
    {
        // Verify chip ID
        let mut buf = [0u8; 1];
        if i2c.write_read(ADDR, &[REG_CHIP_ID], &mut buf).is_err() {
            return false;
        }
        if buf[0] != EXPECTED_CHIP_ID {
            return false;
        }

        // Configure keys 0-7 as an 8-key slider
        // Bit 7 = enable slider, bits 6:0 = number of keys (8)
        if i2c.write(ADDR, &[REG_SLIDER_CTRL, 0x80 | 0x08]).is_err() {
            return false;
        }

        // Set detection threshold for each slider key (lower = more sensitive)
        for key in 0..8u8 {
            let _ = i2c.write(ADDR, &[REG_KEY0_DTHR + key, 0x06]);
        }

        true
    }

    /// Poll the slider. Call this at ~60 Hz or on CHANGE# interrupt.
    /// Returns a SliderEvent if state changed, None otherwise.
    pub fn poll<I2C, E>(&mut self, i2c: &mut I2C) -> Option<SliderEvent>
    where
        I2C: embedded_hal::blocking::i2c::WriteRead<Error = E>,
    {
        // Read detection status + key status
        let mut status = [0u8; 3];
        if i2c
            .write_read(ADDR, &[REG_DET_STATUS], &mut status)
            .is_err()
        {
            return None;
        }

        let slider_active = (status[0] & 0x02) != 0; // SDET bit

        if slider_active {
            // Read slider position (0-255)
            let mut pos_buf = [0u8; 1];
            if i2c
                .write_read(ADDR, &[REG_SLIDER_POS], &mut pos_buf)
                .is_err()
            {
                return None;
            }

            // Map 0-255 to 0-1024 for the strip engine
            let pos = (pos_buf[0] as i32) * 4;

            if !self.was_touching {
                self.was_touching = true;
                self.last_pos = pos;
                Some(SliderEvent::Start(pos))
            } else if pos != self.last_pos {
                self.last_pos = pos;
                Some(SliderEvent::Move(pos))
            } else {
                None // touching but hasn't moved
            }
        } else if self.was_touching {
            self.was_touching = false;
            Some(SliderEvent::End)
        } else {
            None
        }
    }
}
