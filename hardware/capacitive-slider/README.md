# Capacitive Touch Slider — AT42QT2120

Hardware design for a no-moving-parts capacitive touch slider PCB that replaces
the on-screen TouchStrip in the Arpegginator. Connects to Teensy 4.1 over I2C.

## Overview

- **IC**: Microchip AT42QT2120 (12-channel capacitive touch controller)
- **Interface**: I2C (addr 0x1C), up to 400 kHz
- **Supply**: 1.8–5.5 V (run at 3.3 V from Teensy)
- **Output**: Per-key touch status + interpolated slider position
- **Slider channels**: 8 keys configured as a slider (keys 0–7)
- **Extra keys**: Keys 8–11 available for discrete buttons (play, stop, shift, etc.)

## Slider Pad Patterns

Three pattern options are provided below. All assume a **100 mm active length**
and **10 mm PCB width**, single-layer copper on the top side with ground fill on
the bottom.

---

### Pattern A: Interleaved Diamonds (Recommended)

The standard pattern from Microchip's application notes. Best balance of
linearity and noise immunity.

```
  Key0  Key1  Key2  Key3  Key4  Key5  Key6  Key7
  ┌─────────────────────────────────────────────────┐
  │  ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇  │
  │ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇ ◇  │
  │  ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇   ◇  │
  └─────────────────────────────────────────────────┘

  Cross-section (one repeat unit):

      ┌───┐       ┌───┐
     /  A  \     /  B  \        A and B are adjacent channels
    /       \   /       \       Diamond tips interleave
   /    ◆    \ /    ◆    \     so A's falling edge overlaps B's
  /           X           \    rising edge — enables interpolation
  \          / \          /
   \        /   \        /
    \      /     \      /
     \    /       \    /
      \  /         \  /
       \/           \/
```

**Dimensions per diamond:**
- Diamond width: 10 mm (along slider axis)
- Diamond height: 8 mm (across slider width)
- Overlap between adjacent keys: 2.5 mm
- Pitch (center-to-center): 12.5 mm
- Gap between copper edges: 0.3 mm
- 8 keys x 12.5 mm = 100 mm active length

**Trace routing:** Each diamond connects via a thin trace (0.2 mm) routed on the
same layer to the AT42QT2120 pin. Keep traces short and add a ground guard ring
around each trace.

---

### Pattern B: Chevron / Zigzag

Higher edge density gives better sensitivity for lighter touches. Slightly more
complex to route.

```
  Key0  Key1  Key2  Key3  Key4  Key5  Key6  Key7
  ┌─────────────────────────────────────────────────┐
  │ /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\  │
  │ \/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/  │
  │ /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\  │
  │ \/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/  │
  └─────────────────────────────────────────────────┘

  Cross-section:

  Channel A    Channel B
    /\    /\    /\    /\
   /  \  /  \  /  \  /  \
  /  A \/  B \/  A \/  B \    Interlocking zigzag teeth
  \    /\    /\    /\    /    3-4 teeth per channel
   \  /  \  /  \  /  \  /
    \/    \/    \/    \/
```

**Dimensions:**
- Tooth height: 4 mm
- Tooth pitch: 2.5 mm
- 3 teeth per key, keys spaced at 12.5 mm
- Gap: 0.3 mm

---

### Pattern C: Simple Rectangular Bars

Easiest to lay out. Lower interpolation quality but perfectly adequate for
scrolling. Good starting point if this is your first capacitive PCB.

```
  Key0  Key1  Key2  Key3  Key4  Key5  Key6  Key7
  ┌─────────────────────────────────────────────────┐
  │ ████  ████  ████  ████  ████  ████  ████  ████ │
  │ ████  ████  ████  ████  ████  ████  ████  ████ │
  │ ████  ████  ████  ████  ████  ████  ████  ████ │
  └─────────────────────────────────────────────────┘

  Cross-section:

  ┌──────┐ ┌──────┐ ┌──────┐
  │      │ │      │ │      │   Simple rectangular pads
  │  A   │ │  B   │ │  C   │   with gaps between them.
  │      │ │      │ │      │   Interpolation uses signal
  └──────┘ └──────┘ └──────┘   strength ratio of neighbors.
     gap      gap      gap
```

**Dimensions:**
- Pad width: 11 mm (along slider axis)
- Pad height: 8 mm
- Gap: 1.5 mm
- Pitch: 12.5 mm

---

## Schematic

```
                          AT42QT2120
                     ┌──────────────────┐
  Teensy SDA ───────┤ SDA          KEY0 ├─── Slider pad 0
  Teensy SCL ───────┤ SCL          KEY1 ├─── Slider pad 1
                    │              KEY2 ├─── Slider pad 2
  3.3V ──┬─────────┤ VDD          KEY3 ├─── Slider pad 3
         │  100nF  │              KEY4 ├─── Slider pad 4
         ├──||─────┤ VSS (GND)    KEY5 ├─── Slider pad 5
         │         │              KEY6 ├─── Slider pad 6
  GND ───┴─────────┤ VSS          KEY7 ├─── Slider pad 7
                    │                   │
                    │ CHANGE# ──────────┼─── Teensy GPIO (interrupt)
                    │                   │
                    │ KEY8  ─────────── ┼─── (optional: Play btn)
                    │ KEY9  ─────────── ┼─── (optional: Stop btn)
                    │ KEY10 ─────────── ┼─── (optional: Shift btn)
                    │ KEY11 ─────────── ┼─── (optional: Mode btn)
                    │                   │
                    │ MODE  ─────────── ┼─── GND (I2C mode)
                    └──────────────────┘

  Pull-ups: 4.7 kOhm on SDA and SCL to 3.3V
  Decoupling: 100 nF + 10 uF on VDD/VSS
```

## Bill of Materials

| Ref  | Part              | Package    | Qty | Notes                         |
|------|-------------------|------------|-----|-------------------------------|
| U1   | AT42QT2120-MMH    | QFN-24     | 1   | Capacitive touch controller   |
| C1   | 100 nF ceramic    | 0402/0603  | 1   | VDD decoupling                |
| C2   | 10 uF ceramic     | 0805       | 1   | VDD bulk decoupling           |
| R1   | 4.7 kOhm         | 0402/0603  | 1   | I2C SDA pull-up               |
| R2   | 4.7 kOhm         | 0402/0603  | 1   | I2C SCL pull-up               |
| J1   | 4-pin header      | 2.54mm     | 1   | VCC, GND, SDA, SCL (+ CHANGE#)|
| --   | PCB copper pads   | --         | 8   | Slider electrode pattern      |

**Total component cost: ~$2-3**

## PCB Layout Guidelines

1. **Ground plane**: Solid ground on bottom layer. Do NOT place ground copper
   directly under the slider pads — leave a keepout zone. Ground surrounds
   the pads but doesn't overlap.

2. **Overlay**: Apply solder mask over the slider pads for a smooth touch
   surface. The 35 um solder mask acts as a thin dielectric — sensitivity
   remains excellent through it.

3. **Trace routing**: Keep sense traces short (<20 mm). Route away from noisy
   signals (PWM, clocks). Add ground guard traces between sense traces.

4. **Board thickness**: Standard 1.6 mm FR4 is fine. Thinner (0.8 mm) gives
   slightly better sensitivity but isn't necessary.

5. **Finger contact area**: The slider should be at least 8 mm wide to ensure
   reliable finger detection.

6. **IC placement**: Place AT42QT2120 at one end of the slider strip, close to
   the connector. This minimizes trace length to the connector.

## AT42QT2120 Register Configuration

To configure keys 0-7 as a slider, write these registers at startup:

| Register | Value  | Description                                    |
|----------|--------|------------------------------------------------|
| 0x00     | (read) | Chip ID — should return 0x3E                   |
| 0x0E     | 0x08   | Slider control: enable slider, 8 keys          |
| 0x10-17  | 0x04   | Per-key threshold (lower = more sensitive)      |
| 0x1E-25  | 0x00   | Per-key detect integrator (0 = default 4)       |
| 0x06     | (read) | Slider position: 0-255                          |

The slider position register (0x06) returns 0-255, which is used directly
by the Arpegginator strip engine (native 0-255 range):

```rust
let pos = i2c_read_reg(0x1C, 0x06) as i32;  // 0-255, used as-is
```

## Teensy 4.1 Wiring

| Teensy Pin | Signal   | Notes                    |
|------------|----------|--------------------------|
| 18 (SDA0)  | SDA     | I2C bus 0                |
| 19 (SCL0)  | SCL     | I2C bus 0                |
| 2 (GPIO)   | CHANGE# | Active-low interrupt     |
| 3.3V       | VDD     | Power                    |
| GND        | VSS     | Ground                   |

## Two Sliders

The Arpegginator uses two strips (vertical + horizontal). Options:

1. **Two AT42QT2120s**: Each on its own I2C address — but the AT42QT2120 has
   a fixed address (0x1C). Use an I2C multiplexer (TCA9548A) or...

2. **One AT42QT2120, split keys**: Use keys 0-3 as slider A (vertical,
   4 keys) and keys 4-7 as slider B (horizontal, 4 keys). Lower resolution
   per slider but simpler. The chip supports configuring two separate sliders.

3. **Two PCBs + TCA9548A mux**: Cleanest solution. Each slider is an
   independent 8-key strip. The mux adds one more IC but gives full resolution
   on both axes.

**Recommendation**: Option 3 if you want full resolution on both. Option 2 if
you want a single board.
