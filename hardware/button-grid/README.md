# 16×8 Button Grid PCB

KiCad PCB for the Arpegginator's main button grid: 128 Kailh Choc v1
low-profile switches with per-key RGBW LEDs and anti-ghosting diodes.

## Specs

| Parameter        | Value                                      |
|------------------|--------------------------------------------|
| Grid             | 16 columns × 8 rows (128 keys)            |
| Switch           | Kailh Choc v1 (PG1350), through-hole       |
| LED              | SK6812MINI-E RGBW (3535), addressable chain |
| Anti-ghost diode | 1N4148W (SOD-323), one per switch          |
| Scanning         | 16 column + 8 row GPIO pins (24 total)     |
| LED data         | 1 GPIO pin (serial chain, 128 LEDs)        |
| Key spacing      | 19.05 mm (standard 1U)                     |
| Board size       | ~320 × 172 mm                              |
| Layers           | 2 (F.Cu + B.Cu)                            |

## Matrix Wiring

Each key cell:

```
COL pin ──── SW pad 1 ─┤ switch ├── SW pad 2 ──── Diode anode ─┤►├── Diode cathode ──── ROW pin
```

The 1N4148W diode on each switch prevents ghosting when multiple keys are
pressed simultaneously. Cathode connects to the row line, anode to the switch.

Scanning: drive one column LOW at a time, read all 8 rows. A pressed key
pulls its row LOW through the diode.

## LED Chain

SK6812MINI-E LEDs are daisy-chained in a snaking pattern:

```
Row 0:  LED1 → LED2 → ... → LED16    (left to right)
Row 1:  LED17 ← LED18 ← ... ← LED32  (right to left)
Row 2:  LED33 → LED34 → ... → LED48   (left to right)
  ...etc...
```

This minimizes routing distance for the data line. One GPIO pin (LED_DIN)
drives the entire chain.

## Connectors

- **J1** (20-pin header): COL0–COL15, VCC, GND, LED_DIN, spare
- **J2** (8-pin header): ROW0–ROW7

Both at the bottom edge, 2.54 mm pitch.

## Teensy 4.1 Pin Mapping (suggested)

| Function     | Teensy Pins          | Count |
|--------------|----------------------|-------|
| COL0–COL15   | 0–9, 10–15           | 16    |
| ROW0–ROW7    | 16–17, 20–25         | 8     |
| LED_DIN      | 26 (or any GPIO)     | 1     |
| VCC          | 3.3V                 | 1     |
| GND          | GND                  | 1     |

## Generating the PCB

```bash
python3 generate_pcb.py > button_grid.kicad_pcb
```

All geometry is parameterized at the top of the script. Adjust `PITCH`,
`MARGIN`, switch footprint offsets, etc. as needed then regenerate.

## Trace Routing (fully routed)

The generated PCB includes complete trace routing (1117 traces, 639 vias):

**F.Cu (front copper):**
- **Column buses**: Vertical trunk at 2.5 mm left of switch center (dodges
  the 3 mm center post), with horizontal stubs to each switch pad 1
- **Switch→diode**: Short vertical trace from switch pad 2 to diode anode

**B.Cu (back copper):**
- **Row buses**: Horizontal traces connecting all 16 diode cathodes per row,
  via at each diode cathode to drop from F.Cu to B.Cu
- **LED data chain**: Horizontal channel at cy−2.0 mm for intra-row
  connections; inter-row connections route through the board margins
  (left for odd→even, right for even→odd transitions)
- **LED VCC bus**: Horizontal power trace (0.5 mm) per row at cy−4.5 mm,
  via at each LED VCC pad with short stub to the bus
- **GND fill**: Full board ground pour, auto-clearance around all other nets

**LED GND**: Via at each LED GND pad connects directly to the B.Cu ground fill.

**Not routed**: Connector fan-out from grid to J1/J2. The column and row buses
are fully connected within the grid, but the last-mile routing to the pin
headers depends on your physical connector choice. Route these manually in KiCad
or replace J1/J2 with direct wiring pads.

## Bill of Materials

| Ref      | Part            | Package    | Qty | Notes                    |
|----------|-----------------|------------|-----|--------------------------|
| SW1–128  | Kailh Choc v1   | PG1350     | 128 | Low-profile mech switch  |
| D1–128   | 1N4148W         | SOD-323    | 128 | Anti-ghosting diode      |
| LED1–128 | SK6812MINI-E    | 3535       | 128 | RGBW addressable LED     |
| J1       | Pin header 1×20 | 2.54 mm    | 1   | Columns + power + LED    |
| J2       | Pin header 1×8  | 2.54 mm    | 1   | Rows                     |
