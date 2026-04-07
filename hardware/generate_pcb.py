#!/usr/bin/env python3
"""Generate a KiCad 7 PCB for the Arpegginator 16×8 button grid.

Components per cell:
  - Kailh Choc v1 (PG1350) low-profile switch
  - 1N4148W (SOD-323) anti-ghosting diode
  - SK6812MINI-E (3535) RGBW addressable LED

Matrix: 16 columns × 8 rows, scanned via SPI (MCP23S17 expanders).
LED chain: single data line, snaking row-by-row (128 LEDs).

Run:  python3 generate_pcb.py > button_grid.kicad_pcb
"""

import sys

# ── Grid geometry ─────────────────────────────────────────────────────
COLS = 16
ROWS = 8
PITCH = 19.05  # standard keyboard unit (mm)

MARGIN = 2.0                                    # minimal edge clearance
SLIDER_W = PITCH                                # vertical slider width (1 button)
CONN_AREA_W = 66.0                              # display + small margin
EXTRA_ROW = 1                                   # row 9 (modifier keys + space + h-slider)
BOARD_W = SLIDER_W + COLS * PITCH + 2 * MARGIN + CONN_AREA_W
BOARD_H = (ROWS + EXTRA_ROW) * PITCH + 2 * MARGIN

# Origin of cell (0,0) — top-left switch center (shifted right for v-slider)
ORIGIN_X = MARGIN + SLIDER_W + PITCH / 2
ORIGIN_Y = MARGIN + PITCH / 2


def cell_center(row, col):
    return (ORIGIN_X + col * PITCH, ORIGIN_Y + row * PITCH)


# ── Kailh Choc v1 (PG1350) ───────────────────────────────────────────
# Pad offsets relative to switch center (top view, standard orientation)
SW_PAD1 = (0, 5.9)       # center-bottom electrical pin
SW_PAD2 = (-5.0, 3.8)    # left electrical pin (kiswitch rotated 180° so pin 2 is on left)
SW_PAD_DRILL = 1.2
SW_PAD_SIZE = 2.2
SW_CENTER_DRILL = 3.45    # center alignment post (NPTH) — matches kiswitch/datasheet
SW_SIDE_POSTS = [(-5.5, 0), (5.5, 0)]  # side alignment (NPTH) — matches kiswitch/datasheet
SW_SIDE_DRILL = 1.9       # matches kiswitch/datasheet

# ── 1N4148W diode (SOD-323, KiCad standard) ─────────────────────────
# Placed to the right of the switch, connecting SW_PAD2 to the row line.
# Anode at top (connects to switch pad 2), cathode at bottom (connects to row).
# KiCad SOD-323 pads: (±1.05, 0) size 0.6×0.45 — rotated 90° for vertical
DIODE_OFFSET = (-8.5, 7.0)  # left of switch outline, between rows
DIODE_PAD_DY = 1.05          # pad center offset — cathode below (away from pin 2), anode above (toward pin 2)
DIODE_PAD_W = 0.45           # pad width (along edge, was perpendicular)
DIODE_PAD_H = 0.6            # pad height (perpendicular to edge)

# ── SK6812MINI-E RGBW LED (3535) ─────────────────────────────────────
# Placed at switch center (shines through/around keycap)
LED_OFFSET = (0, -4.7)      # centered on LED window per PG1350 datasheet (4.70mm above switch center = top)
LED_PAD_DX = 1.2             # half-spacing horizontal
LED_PAD_DY = 0.8             # half-spacing vertical
LED_PAD_W = 0.7
LED_PAD_H = 0.7
# Pin 1=VDD (TL), Pin 2=DOUT (TR), Pin 3=GND (BR), Pin 4=DIN (BL)

# ── MCP23S17 SPI I/O Expanders (QFN-28, 6×6mm, KiCad standard) ─────
# QFN-28-1EP_6x6mm_P0.65mm_EP4.25x4.25mm
QFN_PAD_EDGE = 2.8375           # pad center distance from chip center
QFN_PAD_PITCH = 0.65            # pin pitch
QFN_PAD_W = 0.3                 # pad width (along edge)
QFN_PAD_H = 1.025               # pad height (perpendicular to edge)
QFN_PINS_PER_SIDE = 7
QFN_EP_SIZE = 4.25              # exposed pad size
QFN_THERMAL_VIA_GRID = [-1.42, 0, 1.42]  # 3x3 grid positions
QFN_THERMAL_VIA_SIZE = 1.14     # thermal via pad size

# QFN rotation: 90° CCW (pins rotate counter-clockwise)
QFN_ROTATION = 90

# 2.4" ILI9341 TFT display (right of grid, rotated 90°, F.Cu side)
# Original module: 43 x 63mm. Rotated: 63 wide x 43 tall.
# Header (9 pins on the short 43mm edge) now at the left edge.
# Left edge aligned to grid right edge.
DISP_MOD_W = 63.0               # width after rotation
DISP_MOD_H = 43.0               # height after rotation
_grid_right = ORIGIN_X + (COLS - 1) * PITCH + PITCH / 2
DISP_X = _grid_right + 3.0      # header X, left side of module, 3mm from grid
DISP_Y = MARGIN + DISP_MOD_H / 2  # centered vertically near top
DISP_PINS = 9
DISP_PITCH = 2.54

# USB-C connector (top edge, right-aligned under display with 7mm margin)
USB_X = _grid_right + DISP_MOD_W - 7.0
USB_Y = 0.0
USB_PAD_W = 0.3
USB_PAD_H = 1.0

# Teensy 4.1 header (mounted on back, below USB-C + power components)
TEENSY_DX = 7.62               # half row spacing (15.24mm / 2)
TEENSY_X = USB_X               # centered under USB-C
TEENSY_Y = 24.0                # below USB D+/D- header + power components
TEENSY_PITCH = 2.54
TEENSY_PINS = 24
TEENSY_PAD_DRILL = 1.0
TEENSY_PAD_SIZE = 1.7
TEENSY_LAST_Y = TEENSY_Y + (TEENSY_PINS - 1) * TEENSY_PITCH

# U1 = column expander (top-right edge of button grid)
# U2 = row expander (bottom-right edge of button grid)
_grid_top = ORIGIN_Y - PITCH / 2
_grid_bot = ORIGIN_Y + (ROWS - 1) * PITCH + PITCH / 2
U1_X = _grid_right + 5.0
U1_Y = _grid_top + 5.0
U2_X = _grid_right + 5.0
U2_Y = _grid_bot - 5.0

# MPR121 touch ICs (QFN-20, 4×4mm, 0.5mm pitch, KiCad standard)
# QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm
MPR_BODY = 4.0
MPR_PITCH = 0.5
MPR_PAD_W = 0.25             # pad width (along edge)
MPR_PAD_H = 0.85             # pad height (perpendicular to edge)
MPR_PAD_EDGE = 1.925          # pad center distance from chip center
MPR_EPAD = 2.6
MPR_PINS_PER_SIDE = 5
MPR_THERMAL_GRID = [-0.65, 0.65]  # 2x2 grid positions
MPR_THERMAL_SIZE = 1.05       # thermal pad size

# Slider IC placement is now handled by slider_assembly()

# 0603 passive pads (KiCad standard R_0603_1608Metric / C_0603_1608Metric)
P0603_PAD_W = 0.8
P0603_PAD_H = 0.95
P0603_PAD_DX = 0.825            # pad center X offset


# ── Net numbering ────────────────────────────────────────────────────
# 0      : ""
# 1-16   : COL0..COL15
# 17-24  : ROW0..ROW7
# 25     : VCC
# 26     : GND
# 27     : LED_DIN  (data input to first LED)
# 28-154 : LED_CHAIN_1..LED_CHAIN_127 (DOUT→DIN between consecutive LEDs)
# 155-282: SW_0_0..SW_7_15 (switch pin 2 → diode anode)
# 283    : I2C_SDA       (MPR121 touch controllers)
# 284    : I2C_SCL       (MPR121 touch controllers)

def net_col(c):        return 1 + c
def net_row(r):        return 17 + r
NET_VCC = 25
NET_GND = 26
NET_LED_DIN = 27
def net_led_chain(n):  return 28 + n - 1   # n = 1..127
def net_sw(r, c):      return 155 + r * COLS + c
_BASE_EXTRA = 155 + ROWS * COLS       # 283
NET_I2C_SDA = _BASE_EXTRA
NET_I2C_SCL = _BASE_EXTRA + 1
# Row 9 matrix wiring (col -1 through 7, ROW8)
# Column nets shifted: col -1→COL0, col 0→COL1, ..., col 7→COL8
NET_ROW8 = _BASE_EXTRA + 2
def net_r9_sw(i): return _BASE_EXTRA + 3 + i   # switch-diode nets, i=0..8
# Vertical slider pads (8)
def net_vslider(i): return _BASE_EXTRA + 12 + i   # i = 0..7
# Horizontal slider pads (8)
def net_hslider(i): return _BASE_EXTRA + 20 + i   # i = 0..7
# MPR121 IRQ outputs
NET_MPR_IRQ_V = _BASE_EXTRA + 28   # vertical slider IRQ
NET_MPR_IRQ_H = _BASE_EXTRA + 29   # horizontal slider IRQ
# Display SPI signals
NET_DISP_CS   = _BASE_EXTRA + 30
NET_DISP_DC   = _BASE_EXTRA + 31
NET_DISP_RST  = _BASE_EXTRA + 32
NET_DISP_MOSI = _BASE_EXTRA + 33
NET_DISP_SCK  = _BASE_EXTRA + 34
NET_DISP_MISO = _BASE_EXTRA + 35
NET_DISP_LED  = _BASE_EXTRA + 36
NET_USB_DP    = _BASE_EXTRA + 37   # USB D+
NET_USB_DN    = _BASE_EXTRA + 38   # USB D-
NET_USB_VBUS  = _BASE_EXTRA + 39
NET_USB_CC1   = _BASE_EXTRA + 40
NET_USB_CC2   = _BASE_EXTRA + 41
NET_LED_VCC   = _BASE_EXTRA + 42   # high-current 5V rail for LEDs (from VBUS)
NET_VCC_FUSED = _BASE_EXTRA + 43   # VBUS after polyfuse, before ferrite split
NET_SPI_CS_U1 = _BASE_EXTRA + 44   # SPI CS for MCP23S17 column expander
NET_SPI_CS_U2 = _BASE_EXTRA + 45   # SPI CS for MCP23S17 row expander
TOTAL_NETS = _BASE_EXTRA + 46


def rc_to_chain(row, col):
    """LED chain index (0-127). Snakes: even rows L→R, odd rows R→L."""
    if row % 2 == 0:
        return row * COLS + col
    else:
        return row * COLS + (COLS - 1 - col)


def led_din_net(row, col):
    """Net connected to the DIN pin of the LED at (row, col)."""
    ci = rc_to_chain(row, col)
    if ci == 0:
        return NET_LED_DIN
    return net_led_chain(ci)


def led_dout_net(row, col):
    """Net connected to the DOUT pin of the LED at (row, col)."""
    ci = rc_to_chain(row, col)
    if ci == ROWS * COLS - 1:
        return 0  # last LED, unconnected
    return net_led_chain(ci + 1)


# ── Helpers ───────────────────────────────────────────────────────────

def fmt(v):
    return f"{v:.4f}".rstrip('0').rstrip('.')

_uuid_ctr = 0
def uuid():
    global _uuid_ctr
    _uuid_ctr += 1
    return f"00000000-0000-0000-0000-{_uuid_ctr:012d}"


def all_net_names():
    """Return list of (net_id, net_name) for all nets."""
    nets = [(0, '""')]
    for c in range(COLS):
        nets.append((net_col(c), f'"COL{c}"'))
    for r in range(ROWS):
        nets.append((net_row(r), f'"ROW{r}"'))
    nets.append((NET_VCC, '"VCC"'))
    nets.append((NET_GND, '"GND"'))
    nets.append((NET_LED_DIN, '"LED_DIN"'))
    for n in range(1, ROWS * COLS):
        nets.append((net_led_chain(n), f'"LED_CH{n}"'))
    for r in range(ROWS):
        for c in range(COLS):
            nets.append((net_sw(r, c), f'"SW_{r}_{c}"'))
    nets.append((NET_I2C_SDA, '"I2C_SDA"'))
    nets.append((NET_I2C_SCL, '"I2C_SCL"'))
    nets.append((NET_ROW8, '"ROW8"'))
    for i in range(9):
        nets.append((net_r9_sw(i), f'"SW_R9_{i}"'))
    for i in range(8):
        nets.append((net_vslider(i), f'"VSLIDER{i}"'))
    for i in range(8):
        nets.append((net_hslider(i), f'"HSLIDER{i}"'))
    nets.append((NET_MPR_IRQ_V, '"MPR_IRQ_V"'))
    nets.append((NET_MPR_IRQ_H, '"MPR_IRQ_H"'))
    nets.append((NET_USB_DP, '"USB_D+"'))
    nets.append((NET_USB_DN, '"USB_D-"'))
    nets.append((NET_USB_VBUS, '"USB_VBUS"'))
    nets.append((NET_USB_CC1, '"USB_CC1"'))
    nets.append((NET_USB_CC2, '"USB_CC2"'))
    nets.append((NET_DISP_CS, '"DISP_CS"'))
    nets.append((NET_DISP_DC, '"DISP_DC"'))
    nets.append((NET_DISP_RST, '"DISP_RST"'))
    nets.append((NET_DISP_MOSI, '"DISP_MOSI"'))
    nets.append((NET_DISP_SCK, '"DISP_SCK"'))
    nets.append((NET_DISP_MISO, '"DISP_MISO"'))
    nets.append((NET_DISP_LED, '"DISP_LED"'))
    nets.append((NET_LED_VCC, '"LED_VCC"'))
    nets.append((NET_VCC_FUSED, '"VCC_FUSED"'))
    nets.append((NET_SPI_CS_U1, '"SPI_CS_U1"'))
    nets.append((NET_SPI_CS_U2, '"SPI_CS_U2"'))
    return nets


def net_name_by_id(nid):
    """Quick lookup."""
    if nid == 0: return '""'
    for i, nm in all_net_names():
        if i == nid:
            return nm
    return '""'


# Pre-build name lookup
_net_names = {}
def _build_net_names():
    for nid, nm in all_net_names():
        _net_names[nid] = nm
_build_net_names()


def nn(nid):
    return _net_names.get(nid, '""')


# ── Footprint generators ─────────────────────────────────────────────

def switch_footprint(row, col):
    cx, cy = cell_center(row, col)
    ref = f"SW_R{row+1:02d}_C{col+1:02d}"
    col_net = net_col(col)
    sw_net = net_sw(row, col)

    pads = []
    # Electrical pad 1 → column net
    pads.append(f'    (pad "1" thru_hole circle '
                f'(at {fmt(SW_PAD1[0])} {fmt(SW_PAD1[1])}) '
                f'(size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) '
                f'(drill {fmt(SW_PAD_DRILL)}) '
                f'(layers "*.Cu" "*.Mask") '
                f'(net {col_net} {nn(col_net)}))')
    # Electrical pad 2 → switch-diode net
    pads.append(f'    (pad "2" thru_hole circle '
                f'(at {fmt(SW_PAD2[0])} {fmt(SW_PAD2[1])}) '
                f'(size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) '
                f'(drill {fmt(SW_PAD_DRILL)}) '
                f'(layers "*.Cu" "*.Mask") '
                f'(net {sw_net} {nn(sw_net)}))')
    # Center alignment post (NPTH)
    pads.append(f'    (pad "" np_thru_hole circle '
                f'(at 0 0) '
                f'(size {fmt(SW_CENTER_DRILL)} {fmt(SW_CENTER_DRILL)}) '
                f'(drill {fmt(SW_CENTER_DRILL)}) '
                f'(layers "*.Cu" "*.Mask"))')
    # Side alignment posts
    for sx, sy in SW_SIDE_POSTS:
        pads.append(f'    (pad "" np_thru_hole circle '
                    f'(at {fmt(sx)} {fmt(sy)}) '
                    f'(size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) '
                    f'(drill {fmt(SW_SIDE_DRILL)}) '
                    f'(layers "*.Cu" "*.Mask"))')

    pad_str = "\n".join(pads)

    # Silkscreen outline (14x14mm square centered on switch)
    half = 7.0
    silk_lines = [
        f'    (fp_line (start {fmt(-half)} {fmt(-half)}) (end {fmt(half)} {fmt(-half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(half)} {fmt(-half)}) (end {fmt(half)} {fmt(half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(half)} {fmt(half)}) (end {fmt(-half)} {fmt(half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(-half)} {fmt(half)}) (end {fmt(-half)} {fmt(-half)}) (layer "F.SilkS") (width 0.12))',
    ]
    # Courtyard (slightly larger than silkscreen)
    crt = 7.5
    silk_lines.extend([
        f'    (fp_line (start {fmt(-crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(-crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(-crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(-crt)}) (layer "F.CrtYd") (width 0.05))',
    ])
    silk = "\n".join(silk_lines)

    return f"""  (footprint "Arp3:Kailh_Choc_V1" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "Kailh Choc V1 PG1350 low-profile switch")
    (attr through_hole)
    (fp_text reference "{ref}" (at 0 -8.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text value "PG1350" (at 0 8.5) (layer "F.Fab")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
{silk}
{pad_str}
    (model "${{KIPRJMOD}}/3dmodels/SW_Kailh_Choc_V1.stp"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 180))
    )
  )"""


def diode_footprint(row, col):
    cx, cy = cell_center(row, col)
    dx = cx + DIODE_OFFSET[0]
    dy = cy + DIODE_OFFSET[1]
    ref = f"D_R{row+1:02d}_C{col+1:02d}"
    sw_net = net_sw(row, col)     # anode: from switch
    row_net = net_row(row)        # cathode: to row

    # SOD-323 pads — vertical orientation (KiCad standard rotated 90°)
    # Pad 1 = cathode (bottom, away from switch), Pad 2 = anode (top, toward switch pad 2)
    return f"""  (footprint "Arp3:D_SOD-323" (layer "F.Cu")
    (at {fmt(dx)} {fmt(dy)})
    (descr "1N4148W anti-ghosting diode SOD-323")
    (attr smd)
    (fp_text reference "{ref}" (at -2 0) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "1N4148W" (at 2 0) (layer "F.Fab")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_line (start -0.55 -1.35) (end 0.55 -1.35) (layer "F.CrtYd") (width 0.05))
    (fp_line (start 0.55 -1.35) (end 0.55 1.35) (layer "F.CrtYd") (width 0.05))
    (fp_line (start 0.55 1.35) (end -0.55 1.35) (layer "F.CrtYd") (width 0.05))
    (fp_line (start -0.55 1.35) (end -0.55 -1.35) (layer "F.CrtYd") (width 0.05))
    (fp_line (start -0.5 {fmt(-DIODE_PAD_DY)}) (end 0.5 {fmt(-DIODE_PAD_DY)}) (layer "F.SilkS") (width 0.1))
    (pad "1" smd roundrect (at 0 {fmt(DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net {row_net} {nn(row_net)}))
    (pad "2" smd roundrect (at 0 {fmt(-DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net {sw_net} {nn(sw_net)}))
    (model "${{KICAD10_3DMODEL_DIR}}/Diode_SMD.3dshapes/D_SOD-323.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 90))
    )
  )"""


def led_footprint(row, col):
    cx, cy = cell_center(row, col)
    lx = cx + LED_OFFSET[0]
    ly = cy + LED_OFFSET[1]
    ref = f"LED_R{row+1:02d}_C{col+1:02d}"

    din_n = led_din_net(row, col)
    dout_n = led_dout_net(row, col)

    # SK6812MINI-E pinout (top view, standard orientation):
    #   Pin1=VDD (TL)   Pin2=DOUT (TR)
    #   Pin4=DIN (BL)   Pin3=GND  (BR)
    # Odd rows (R→L snake): rotated 180° so DIN/DOUT face chain direction
    s = 1 if row % 2 == 0 else -1
    pads = [
        ("1", -s * LED_PAD_DX, -s * LED_PAD_DY, NET_LED_VCC,  "VDD"),
        ("2",  s * LED_PAD_DX, -s * LED_PAD_DY, dout_n,   "DOUT"),
        ("3",  s * LED_PAD_DX,  s * LED_PAD_DY, NET_GND,  "GND"),
        ("4", -s * LED_PAD_DX,  s * LED_PAD_DY, din_n,    "DIN"),
    ]

    pad_strs = []
    for pin, pdx, pdy, pnet, _label in pads:
        pad_strs.append(
            f'    (pad "{pin}" smd rect '
            f'(at {fmt(pdx)} {fmt(pdy)}) '
            f'(size {fmt(LED_PAD_W)} {fmt(LED_PAD_H)}) '
            f'(layers "F.Cu" "F.Paste" "F.Mask") '
            f'(net {pnet} {nn(pnet)}))')

    pad_str = "\n".join(pad_strs)

    return f"""  (footprint "Arp3:SK6812MINI-E" (layer "F.Cu")
    (at {fmt(lx)} {fmt(ly)})
    (descr "SK6812MINI-E RGBW 3535 addressable LED")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -2.5) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "SK6812MINI-E" (at 0 2.5) (layer "F.Fab")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_line (start -1.75 -1.75) (end 1.75 -1.75) (layer "F.Fab") (width 0.1))
    (fp_line (start 1.75 -1.75) (end 1.75 1.75) (layer "F.Fab") (width 0.1))
    (fp_line (start 1.75 1.75) (end -1.75 1.75) (layer "F.Fab") (width 0.1))
    (fp_line (start -1.75 1.75) (end -1.75 -1.75) (layer "F.Fab") (width 0.1))
    (fp_circle (center -1.3 -1.3) (end -1.1 -1.3) (layer "F.SilkS") (width 0.1))
{pad_str}
  )"""


def qfn_pin_pos(cx, cy, pin, rotation=0):
    """Absolute (x, y) of a MCP23S17 QFN-28 pad (KiCad standard positions).

    QFN-28: 7 pins/side, counterclockwise from pin 1 at top-left.
    Left(1-7), Bottom(8-14), Right(15-21), Top(22-28).
    Rotation in degrees applied after computing local offset.
    """
    import math
    side = (pin - 1) // QFN_PINS_PER_SIDE
    idx = (pin - 1) % QFN_PINS_PER_SIDE
    linear = (idx - 3) * QFN_PAD_PITCH  # -1.95 to +1.95

    if side == 0:    dx, dy = -QFN_PAD_EDGE, linear       # left side pins 1-7
    elif side == 1:  dx, dy = linear, QFN_PAD_EDGE         # bottom side pins 8-14
    elif side == 2:  dx, dy = QFN_PAD_EDGE, -linear        # right side pins 15-21
    else:            dx, dy = -linear, -QFN_PAD_EDGE       # top side pins 22-28

    if rotation != 0:
        rad = math.radians(rotation)
        cos_r, sin_r = math.cos(rad), math.sin(rad)
        dx, dy = dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r

    return (cx + dx, cy + dy)


def col_pin_pos(c):
    """Target position for COL c on U1 (rotated 45°).

    Port A: GPA0(pin21) + GPA1-7(pins22-28) → COL0-7
    Port B: GPB0-6(pins1-7) + GPB7(pin8) → COL8-15
    """
    if c == 0:    return qfn_pin_pos(U1_X, U1_Y, 21, QFN_ROTATION)
    elif c <= 7:  return qfn_pin_pos(U1_X, U1_Y, 21 + c, QFN_ROTATION)
    elif c <= 14: return qfn_pin_pos(U1_X, U1_Y, c - 7, QFN_ROTATION)
    else:         return qfn_pin_pos(U1_X, U1_Y, 8, QFN_ROTATION)


def row_pin_pos(r):
    """Target position for ROW r on U2 (rotated 45°).

    Port A: GPA0(pin21) + GPA1-7(pins22-28) → ROW0-7
    """
    if r == 0:  return qfn_pin_pos(U2_X, U2_Y, 21, QFN_ROTATION)
    else:       return qfn_pin_pos(U2_X, U2_Y, 21 + r, QFN_ROTATION)


def qfn28_footprint(cx, cy, ref, pin_nets, rotation=0):
    """Generate a MCP23S17 QFN-28 footprint (6×6mm, KiCad standard), optionally rotated."""
    import math
    half = 3.0
    pads = []
    for pin in range(1, 29):
        side = (pin - 1) // QFN_PINS_PER_SIDE
        idx = (pin - 1) % QFN_PINS_PER_SIDE
        linear = (idx - 3) * QFN_PAD_PITCH

        # KiCad standard local positions (no rotation applied to pads)
        if side == 0:    dx, dy = -QFN_PAD_EDGE, linear       # left
        elif side == 1:  dx, dy = linear, QFN_PAD_EDGE         # bottom
        elif side == 2:  dx, dy = QFN_PAD_EDGE, -linear        # right
        else:            dx, dy = -linear, -QFN_PAD_EDGE       # top

        nid = pin_nets.get(pin, 0)
        # Pad size: horizontal pads (left/right) or vertical pads (top/bottom)
        if side in (0, 2):
            pw, ph = QFN_PAD_H, QFN_PAD_W  # 1.025 x 0.3
        else:
            pw, ph = QFN_PAD_W, QFN_PAD_H  # 0.3 x 1.025
        pads.append(
            f'    (pad "{pin}" smd roundrect '
            f'(at {fmt(dx)} {fmt(dy)}) '
            f'(size {fmt(pw)} {fmt(ph)}) '
            f'(layers "F.Cu" "F.Paste" "F.Mask") '
            f'(roundrect_rratio 0.25) '
            f'(net {nid} {nn(nid)}))')

    # Exposed pad 29 (GND) — KiCad standard 4.25x4.25mm
    pads.append(
        f'    (pad "29" smd rect (at 0 0) (size {fmt(QFN_EP_SIZE)} {fmt(QFN_EP_SIZE)}) '
        f'(layers "F.Cu" "F.Paste" "F.Mask") '
        f'(net {NET_GND} {nn(NET_GND)}))')

    # Thermal via pads (3x3 grid, unnamed, same net as EP)
    for tx in QFN_THERMAL_VIA_GRID:
        for ty in QFN_THERMAL_VIA_GRID:
            pads.append(
                f'    (pad "" smd rect (at {fmt(tx)} {fmt(ty)}) '
                f'(size {fmt(QFN_THERMAL_VIA_SIZE)} {fmt(QFN_THERMAL_VIA_SIZE)}) '
                f'(layers "F.Cu" "F.Paste" "F.Mask") '
                f'(net {NET_GND} {nn(NET_GND)}))')

    # Fab outline
    outline = [
        f'    (fp_line (start {fmt(-half)} {fmt(-half)}) (end {fmt(half)} {fmt(-half)}) (layer "F.Fab") (width 0.1))',
        f'    (fp_line (start {fmt(half)} {fmt(-half)}) (end {fmt(half)} {fmt(half)}) (layer "F.Fab") (width 0.1))',
        f'    (fp_line (start {fmt(half)} {fmt(half)}) (end {fmt(-half)} {fmt(half)}) (layer "F.Fab") (width 0.1))',
        f'    (fp_line (start {fmt(-half)} {fmt(half)}) (end {fmt(-half)} {fmt(-half)}) (layer "F.Fab") (width 0.1))',
    ]

    # Courtyard (0.25mm clearance from pads)
    crt = 3.6
    courtyard = [
        f'    (fp_line (start {fmt(-crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(-crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(crt)}) (layer "F.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(-crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(-crt)}) (layer "F.CrtYd") (width 0.05))',
    ]

    # Pin 1 marker (top-left corner of left side)
    p1x, p1y = -half + 0.5, -half + 0.5
    rot_angle = f' {rotation}' if rotation != 0 else ''

    return f"""  (footprint "Arp3:MCP23S17_QFN28" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)}{rot_angle})
    (descr "MCP23S17 16-bit SPI I/O expander QFN-28 6x6mm")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -6) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "MCP23S17" (at 0 6) (layer "F.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
{chr(10).join(outline)}
{chr(10).join(courtyard)}
    (fp_circle (center {fmt(p1x)} {fmt(p1y)}) (end {fmt(p1x + 0.2)} {fmt(p1y)}) (layer "F.SilkS") (width 0.1))
{chr(10).join(pads)}
    (model "${{KICAD10_3DMODEL_DIR}}/Package_DFN_QFN.3dshapes/QFN-28-1EP_6x6mm_P0.65mm_EP4.25x4.25mm.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 {rotation}))
    )
  )"""


def tvs_sot143b(cx, cy, ref, net_gnd, net_vcc, net_io1, net_io2, back=False):
    """PRTR5V0U2X ESD protection in SOT-143B (4-pin).

    Pinout: 1=GND, 2=I/O1, 3=VCC, 4=I/O2.
    SOT-143B: pin 1 pad is wider (0.55mm vs 0.4mm for others).
    """
    side = "B" if back else "F"
    # SOT-143B pad positions (KiCad standard)
    # Pins 1,2 on left, pins 3,4 on right. Pitch 1.9mm across, 1.0mm vertical.
    pads_data = [
        ("1", -1.0, 0.5,  0.55, 0.7, net_gnd),   # GND (wider pad)
        ("2", -1.0, -0.5, 0.4,  0.7, net_io1),    # I/O 1
        ("3",  1.0, -0.5, 0.4,  0.7, net_vcc),    # VCC
        ("4",  1.0, 0.5,  0.4,  0.7, net_io2),    # I/O 2
    ]
    pads = []
    for pin, dx, dy, pw, ph, nid in pads_data:
        pads.append(
            f'    (pad "{pin}" smd roundrect '
            f'(at {fmt(dx)} {fmt(dy)}) '
            f'(size {fmt(pw)} {fmt(ph)}) '
            f'(layers "{side}.Cu" "{side}.Paste" "{side}.Mask") '
            f'(roundrect_rratio 0.25) '
            f'(net {nid} {nn(nid)}))')
    return f"""  (footprint "Arp3:PRTR5V0U2X_SOT-143B" (layer "{side}.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "PRTR5V0U2X dual-channel ESD TVS SOT-143B")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -1.5) (layer "{side}.SilkS")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_text value "PRTR5V0U2X" (at 0 1.5) (layer "{side}.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
{chr(10).join(pads)}
  )"""


def passive_0603(cx, cy, ref, value, net1, net2, is_resistor=False, back=False):
    """Generate a 0603 passive (cap or resistor) footprint with KiCad-standard pads."""
    side = "B" if back else "F"
    if is_resistor:
        model_path = "${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step"
        fp_name = "Arp3:R_0603"
    else:
        model_path = "${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0603_1608Metric.step"
        fp_name = "Arp3:C_0603"
    return f"""  (footprint "{fp_name}" (layer "{side}.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "{value}")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -1.2) (layer "{side}.SilkS")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_text value "{value}" (at 0 1.2) (layer "{side}.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_line (start -1.48 -0.73) (end 1.48 -0.73) (layer "{side}.CrtYd") (width 0.05))
    (fp_line (start 1.48 -0.73) (end 1.48 0.73) (layer "{side}.CrtYd") (width 0.05))
    (fp_line (start 1.48 0.73) (end -1.48 0.73) (layer "{side}.CrtYd") (width 0.05))
    (fp_line (start -1.48 0.73) (end -1.48 -0.73) (layer "{side}.CrtYd") (width 0.05))
    (pad "1" smd roundrect (at {fmt(-P0603_PAD_DX)} 0) (size {fmt(P0603_PAD_W)} {fmt(P0603_PAD_H)}) (layers "{side}.Cu" "{side}.Paste" "{side}.Mask") (roundrect_rratio 0.25) (net {net1} {nn(net1)}))
    (pad "2" smd roundrect (at {fmt(P0603_PAD_DX)} 0) (size {fmt(P0603_PAD_W)} {fmt(P0603_PAD_H)}) (layers "{side}.Cu" "{side}.Paste" "{side}.Mask") (roundrect_rratio 0.25) (net {net2} {nn(net2)}))
    (model "{model_path}"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 0))
    )
  )"""


def mcp_components():
    """MCP23S17 SPI expanders, decoupling caps, pull-ups, and output header."""
    parts = []

    # ── U1: column expander (SPI, top-right) ──
    # GPA0-7 → COL0-7, GPB0-7 → COL8-15
    # Pin 11=CS, 12=SCK, 13=SI(MOSI), 14=SO(MISO) — shared SPI0 bus with display
    u1_nets = {}
    u1_nets[21] = net_col(0)                             # GPA0 (top)
    for i in range(1, 8):  u1_nets[21 + i] = net_col(i)  # GPA1-7 (left)
    for i in range(7):     u1_nets[1 + i] = net_col(8 + i) # GPB0-6 (bottom)
    u1_nets[8] = net_col(15)                              # GPB7 (right)
    u1_nets[9] = NET_VCC;  u1_nets[10] = NET_GND
    u1_nets[11] = NET_SPI_CS_U1                           # CS (active low)
    u1_nets[12] = NET_DISP_SCK                            # SCK (shared SPI0 bus)
    u1_nets[13] = NET_DISP_MOSI                           # SI / MOSI (shared SPI0 bus)
    u1_nets[14] = NET_DISP_MISO                           # SO / MISO (shared SPI0 bus)
    u1_nets[15] = NET_GND;  u1_nets[16] = NET_GND;  u1_nets[17] = NET_GND
    u1_nets[18] = NET_VCC
    parts.append(qfn28_footprint(U1_X, U1_Y, "U1", u1_nets, QFN_ROTATION))

    # ── U2: row expander (SPI, center-bottom of grid) ──
    # GPA0-7 → ROW0-7, GPB spare
    u2_nets = {}
    u2_nets[21] = net_row(0)                              # GPA0 (top)
    for i in range(1, 8):  u2_nets[21 + i] = net_row(i)  # GPA1-7 (left)
    u2_nets[9] = NET_VCC;  u2_nets[10] = NET_GND
    u2_nets[11] = NET_SPI_CS_U2                           # CS (active low)
    u2_nets[12] = NET_DISP_SCK                            # SCK (shared SPI0 bus)
    u2_nets[13] = NET_DISP_MOSI                           # SI / MOSI (shared SPI0 bus)
    u2_nets[14] = NET_DISP_MISO                           # SO / MISO (shared SPI0 bus)
    u2_nets[15] = NET_GND;  u2_nets[16] = NET_GND;  u2_nets[17] = NET_GND
    u2_nets[18] = NET_VCC
    parts.append(qfn28_footprint(U2_X, U2_Y, "U2", u2_nets, QFN_ROTATION))

    # ── Decoupling caps (near each chip) ──
    parts.append(passive_0603(U1_X, U1_Y + 5, "C1", "100nF", NET_VCC, NET_GND))
    parts.append(passive_0603(U2_X, U2_Y - 5, "C2", "100nF", NET_VCC, NET_GND))

    # ── I2C pull-ups (for MPR121 touch controllers, near Teensy pins 19/18) ──
    i2c_x = TEENSY_X + TEENSY_DX + 3   # just right of Teensy
    i2c_scl_y = TEENSY_Y + 7 * TEENSY_PITCH   # R8 = pin 19 (SCL)
    i2c_sda_y = TEENSY_Y + 8 * TEENSY_PITCH   # R9 = pin 18 (SDA)
    parts.append(passive_0603(i2c_x, i2c_sda_y, "R1", "4.7k", NET_I2C_SDA, NET_VCC, is_resistor=True))
    parts.append(passive_0603(i2c_x, i2c_scl_y, "R2", "4.7k", NET_I2C_SCL, NET_VCC, is_resistor=True))

    # ── Teensy 4.1 headers (mounted on back, USB at top) ──
    # Left side: GND, 0-12, 3.3V, 24-32
    left_nets = [
        NET_GND,        # GND
        0,              # pin 0 (spare)
        NET_LED_DIN,    # pin 1 → LED data
        0,              # pin 2 (spare)
        0,              # pin 3 (spare)
        0,              # pin 4 (spare)
        0,              # pin 5 (spare)
        NET_DISP_DC,    # pin 6 → display DC
        NET_DISP_RST,   # pin 7 → display RST
        NET_DISP_LED,   # pin 8 → display backlight
        0,              # pin 9 (spare)
        NET_DISP_CS,    # pin 10 → display CS (SPI0 CS0)
        NET_DISP_MOSI,  # pin 11 → SPI0 MOSI (shared: display + MCP23S17)
        NET_DISP_MISO,  # pin 12 → SPI0 MISO (shared: display + MCP23S17)
        NET_VCC,        # 3.3V
        0, 0, 0, 0, 0, 0, 0, 0, 0,         # pins 24-32 (spare)
    ]
    # Right side: Vin, GND, 3.3V, 23-13, 41-33
    right_nets = [
        NET_VCC,        # Vin
        NET_GND,        # GND
        NET_VCC,        # 3.3V
        0, 0,           # pins 23-22 (spare)
        NET_SPI_CS_U2,  # pin 21 → MCP23S17 U2 CS
        NET_SPI_CS_U1,  # pin 20 → MCP23S17 U1 CS
        NET_I2C_SCL,    # pin 19 → SCL (MPR121 touch)
        NET_I2C_SDA,    # pin 18 → SDA (MPR121 touch)
        0, 0, 0, 0,    # pins 17-14 (spare)
        NET_DISP_SCK,   # pin 13 → SPI0 SCK (shared: display + MCP23S17)
        0, 0, 0, 0, 0, 0, 0, 0, 0,  # pins 41-33 (spare)
    ]

    left_x = TEENSY_X - TEENSY_DX
    right_x = TEENSY_X + TEENSY_DX

    teensy_pads = []
    for i in range(TEENSY_PINS):
        py = i * TEENSY_PITCH
        nid_l = left_nets[i] if i < len(left_nets) else 0
        nid_r = right_nets[i] if i < len(right_nets) else 0
        # KiCad pin header style: pad 1 is rect, rest are circle
        l_shape = "rect" if i == 0 else "circle"
        r_shape = "rect" if i == 0 else "circle"
        teensy_pads.append(
            f'    (pad "L{i+1}" thru_hole {l_shape} '
            f'(at {fmt(-TEENSY_DX)} {fmt(py)}) '
            f'(size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) '
            f'(drill {fmt(TEENSY_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid_l} {nn(nid_l)}))')
        teensy_pads.append(
            f'    (pad "R{i+1}" thru_hole {r_shape} '
            f'(at {fmt(TEENSY_DX)} {fmt(py)}) '
            f'(size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) '
            f'(drill {fmt(TEENSY_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid_r} {nn(nid_r)}))')

    mid_y = (TEENSY_PINS - 1) * TEENSY_PITCH / 2
    parts.append(f"""  (footprint "Arp3:Teensy41" (layer "F.Cu")
    (at {fmt(TEENSY_X)} {fmt(TEENSY_Y)})
    (descr "Teensy 4.1 header sockets (mounted on back)")
    (attr through_hole)
    (fp_text reference "U3" (at 0 -3) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text value "Teensy 4.1" (at 0 {fmt(mid_y + 3)}) (layer "F.Fab")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_line (start {fmt(-TEENSY_DX - 1)} -2) (end {fmt(TEENSY_DX + 1)} -2) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(TEENSY_DX + 1)} -2) (end {fmt(TEENSY_DX + 1)} {fmt(mid_y * 2 + 2)}) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(TEENSY_DX + 1)} {fmt(mid_y * 2 + 2)}) (end {fmt(-TEENSY_DX - 1)} {fmt(mid_y * 2 + 2)}) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(-TEENSY_DX - 1)} {fmt(mid_y * 2 + 2)}) (end {fmt(-TEENSY_DX - 1)} -2) (layer "F.Fab") (width 0.1))
{chr(10).join(teensy_pads)}
  )""")

    # ── USB device D+/D- wire pads (rotated 90°, between power and Teensy) ──
    usb_dev_x = USB_X             # centered under USB-C
    usb_dev_y = 19.0              # between power components (~15) and Teensy (24)
    parts.append(f"""  (footprint "Arp3:USB_Dev_Pads" (layer "F.Cu")
    (at {fmt(usb_dev_x)} {fmt(usb_dev_y)})
    (descr "USB device D+/D- wire pads for Teensy micro-USB connection")
    (attr through_hole)
    (fp_text reference "J4" (at 0 -2.5) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "USB D+/D-" (at 0 2.5) (layer "F.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (pad "1" thru_hole circle (at {fmt(-TEENSY_PITCH / 2)} 0) (size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) (drill {fmt(TEENSY_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {NET_USB_DP} {nn(NET_USB_DP)}))
    (pad "2" thru_hole circle (at {fmt(TEENSY_PITCH / 2)} 0) (size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) (drill {fmt(TEENSY_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {NET_USB_DN} {nn(NET_USB_DN)}))
    (fp_line (start {fmt(-TEENSY_PITCH / 2 - 1.2)} -1.2) (end {fmt(TEENSY_PITCH / 2 + 1.2)} -1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(TEENSY_PITCH / 2 + 1.2)} -1.2) (end {fmt(TEENSY_PITCH / 2 + 1.2)} 1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(TEENSY_PITCH / 2 + 1.2)} 1.2) (end {fmt(-TEENSY_PITCH / 2 - 1.2)} 1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(-TEENSY_PITCH / 2 - 1.2)} 1.2) (end {fmt(-TEENSY_PITCH / 2 - 1.2)} -1.2) (layer "F.SilkS") (width 0.12))
  )""")

    # ── Display header (2.4" ILI9341 TFT, 9-pin) ──
    disp_nets = [
        NET_VCC, NET_GND, NET_DISP_CS, NET_DISP_RST, NET_DISP_DC,
        NET_DISP_MOSI, NET_DISP_SCK, NET_DISP_LED, NET_DISP_MISO,
    ]
    disp_pads = []
    for i, nid in enumerate(disp_nets):
        # KiCad pin header style: pad 1 is rect, rest are circle
        pad_shape = "rect" if i == 0 else "circle"
        disp_pads.append(
            f'    (pad "{i+1}" thru_hole {pad_shape} '
            f'(at 0 {fmt(i * DISP_PITCH)}) '
            f'(size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) '
            f'(drill {fmt(TEENSY_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid} {nn(nid)}))')
    # Module outline on Dwgs.User layer
    # Header is on the left edge, module extends right
    # Pins are vertical (along the left short edge of the rotated module)
    half_h = DISP_MOD_H / 2
    mod_left = -3.0    # header is 3mm from module left edge
    mod_right = mod_left + DISP_MOD_W
    parts.append(f"""  (footprint "Arp3:ILI9341_2.4inch" (layer "F.Cu")
    (at {fmt(DISP_X)} {fmt(DISP_Y)})
    (descr "2.4 inch ILI9341 TFT display module, rotated 90 deg")
    (attr through_hole)
    (fp_text reference "J2" (at {fmt(mod_left - 3)} 0) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text value "TFT 2.4in" (at {fmt((mod_left + mod_right) / 2)} 0) (layer "F.Fab")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_line (start {fmt(mod_left)} {fmt(-half_h)}) (end {fmt(mod_right)} {fmt(-half_h)}) (layer "Dwgs.User") (width 0.15))
    (fp_line (start {fmt(mod_right)} {fmt(-half_h)}) (end {fmt(mod_right)} {fmt(half_h)}) (layer "Dwgs.User") (width 0.15))
    (fp_line (start {fmt(mod_right)} {fmt(half_h)}) (end {fmt(mod_left)} {fmt(half_h)}) (layer "Dwgs.User") (width 0.15))
    (fp_line (start {fmt(mod_left)} {fmt(half_h)}) (end {fmt(mod_left)} {fmt(-half_h)}) (layer "Dwgs.User") (width 0.15))
{chr(10).join(disp_pads)}
    (model "${{KICAD10_3DMODEL_DIR}}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x09_P2.54mm_Vertical.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 0))
    )
  )""")

    # ── USB-C connector (top edge, mid-mount) ──
    usb_pads = []
    # GND shield tabs (through-hole)
    for sx in [-4.32, -3.2, 3.2, 4.32]:
        usb_pads.append(
            f'    (pad "SH" thru_hole circle (at {fmt(sx)} 1.5) '
            f'(size 1.0 1.0) (drill 0.6) (layers "*.Cu" "*.Mask") '
            f'(net {NET_GND} {nn(NET_GND)}))')
    # Signal pads (USB 2.0 device: D+, D-, VBUS, GND, CC1, CC2)
    usb_pin_nets = [
        (NET_GND, "A1"), (0, "A2"), (0, "A3"), (NET_USB_VBUS, "A4"),
        (NET_USB_CC1, "A5"), (NET_USB_DP, "A6"), (NET_USB_DN, "A7"),
        (0, "A8"), (NET_USB_VBUS, "A9"), (0, "A10"), (0, "A11"),
        (NET_GND, "A12"),
    ]
    for idx, (nid, label) in enumerate(usb_pin_nets):
        px = -2.75 + idx * 0.5
        usb_pads.append(
            f'    (pad "{label}" smd rect (at {fmt(px)} 0) '
            f'(size {fmt(USB_PAD_W)} {fmt(USB_PAD_H)}) '
            f'(layers "F.Cu" "F.Paste" "F.Mask") '
            f'(net {nid} {nn(nid)}))')
    parts.append(f"""  (footprint "Arp3:USB_C_Mid_Mount" (layer "F.Cu")
    (at {fmt(USB_X)} {fmt(USB_Y)})
    (descr "USB Type-C mid-mount receptacle")
    (attr smd)
    (fp_text reference "J3" (at 0 4) (layer "F.SilkS")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (fp_text value "USB-C" (at 0 -2) (layer "F.Fab")
      (effects (font (size 0.5 0.5) (thickness 0.08)))
    )
    (fp_line (start -4.5 -1.5) (end 4.5 -1.5) (layer "F.Fab") (width 0.1))
    (fp_line (start 4.5 -1.5) (end 4.5 3) (layer "F.Fab") (width 0.1))
    (fp_line (start 4.5 3) (end -4.5 3) (layer "F.Fab") (width 0.1))
    (fp_line (start -4.5 3) (end -4.5 -1.5) (layer "F.Fab") (width 0.1))
{chr(10).join(usb_pads)}
    (model "${{KICAD10_3DMODEL_DIR}}/Connector_USB.3dshapes/USB_C_Receptacle_GCT_USB4110.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 0))
    )
  )""")

    # CC resistors (5.1kΩ, required for USB-C device mode)
    parts.append(passive_0603(USB_X - 2, USB_Y + 5, "R3", "5.1k", NET_USB_CC1, NET_GND, is_resistor=True))
    parts.append(passive_0603(USB_X + 2, USB_Y + 5, "R4", "5.1k", NET_USB_CC2, NET_GND, is_resistor=True))
    # VBUS input decoupling
    parts.append(passive_0603(USB_X, USB_Y + 7, "C7", "10uF", NET_USB_VBUS, NET_GND))

    # ── Power distribution: VBUS → polyfuse → split to LED_VCC + VCC ──
    pwr_x = USB_X
    pwr_y = USB_Y + 10

    # F1: Polyfuse (1206 PTC, 2A hold) — VBUS → VCC_FUSED
    parts.append(passive_0603(pwr_x, pwr_y, "F1", "2A PTC", NET_USB_VBUS, NET_VCC_FUSED, is_resistor=True))

    # LED_VCC: direct from fused VBUS (high current path)
    # C8: bulk cap (100µF) on LED_VCC for inrush
    parts.append(passive_0603(pwr_x - 3, pwr_y + 3, "C8", "100uF", NET_LED_VCC, NET_GND))
    # Jumper wire: VCC_FUSED → LED_VCC (0Ω or direct trace)
    parts.append(passive_0603(pwr_x, pwr_y + 3, "R5", "0R", NET_VCC_FUSED, NET_LED_VCC, is_resistor=True))

    # VCC: filtered for Teensy + ICs (low current path)
    # FB1: Ferrite bead (0805, 600Ω@100MHz) — VCC_FUSED → VCC
    parts.append(passive_0603(pwr_x + 3, pwr_y + 3, "FB1", "600R@100MHz", NET_VCC_FUSED, NET_VCC, is_resistor=True))
    # C9: decoupling on VCC after ferrite
    parts.append(passive_0603(pwr_x + 3, pwr_y + 5, "C9", "10uF", NET_GND, NET_VCC))

    return "\n".join(parts)


# ── MPR121 touch controller footprints ───────────────────────────────

def mpr121_footprint(cx, cy, ref, pin_nets, back=False):
    """MPR121 QFN-20 (4×4mm, 0.5mm pitch, 5 pins/side, KiCad standard)."""
    side = "B" if back else "F"
    half = MPR_BODY / 2
    pads = []
    for pin in range(1, 21):
        qside = (pin - 1) // MPR_PINS_PER_SIDE
        idx = (pin - 1) % MPR_PINS_PER_SIDE
        linear = (idx - 2) * MPR_PITCH  # -1.0 to +1.0

        # KiCad standard positions
        if qside == 0:    dx, dy = -MPR_PAD_EDGE, linear       # left
        elif qside == 1:  dx, dy = linear, MPR_PAD_EDGE         # bottom
        elif qside == 2:  dx, dy = MPR_PAD_EDGE, -linear        # right
        else:             dx, dy = -linear, -MPR_PAD_EDGE       # top

        nid = pin_nets.get(pin, 0)
        if qside in (0, 2):
            pw, ph = MPR_PAD_H, MPR_PAD_W  # 0.85 x 0.25
        else:
            pw, ph = MPR_PAD_W, MPR_PAD_H  # 0.25 x 0.85
        pads.append(
            f'    (pad "{pin}" smd roundrect '
            f'(at {fmt(dx)} {fmt(dy)}) '
            f'(size {fmt(pw)} {fmt(ph)}) '
            f'(layers "{side}.Cu" "{side}.Paste" "{side}.Mask") '
            f'(roundrect_rratio 0.25) '
            f'(net {nid} {nn(nid)}))')

    # Exposed pad 21 (GND)
    pads.append(
        f'    (pad "21" smd rect (at 0 0) (size {fmt(MPR_EPAD)} {fmt(MPR_EPAD)}) '
        f'(layers "{side}.Cu" "{side}.Paste" "{side}.Mask") '
        f'(net {NET_GND} {nn(NET_GND)}))')

    # Thermal pads (2x2 grid, unnamed)
    for tx in MPR_THERMAL_GRID:
        for ty in MPR_THERMAL_GRID:
            pads.append(
                f'    (pad "" smd rect (at {fmt(tx)} {fmt(ty)}) '
                f'(size {fmt(MPR_THERMAL_SIZE)} {fmt(MPR_THERMAL_SIZE)}) '
                f'(layers "{side}.Cu" "{side}.Paste" "{side}.Mask") '
                f'(net {NET_GND} {nn(NET_GND)}))')

    # Courtyard
    crt = 2.6
    courtyard = [
        f'    (fp_line (start {fmt(-crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(-crt)}) (layer "{side}.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(-crt)}) (end {fmt(crt)} {fmt(crt)}) (layer "{side}.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(crt)}) (layer "{side}.CrtYd") (width 0.05))',
        f'    (fp_line (start {fmt(-crt)} {fmt(crt)}) (end {fmt(-crt)} {fmt(-crt)}) (layer "{side}.CrtYd") (width 0.05))',
    ]

    return f"""  (footprint "Arp3:MPR121_QFN20" (layer "{side}.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "MPR121 capacitive touch controller QFN-20 4x4mm")
    (attr smd)
    (fp_text reference "{ref}" (at 0 {fmt(-half - 1.5)}) (layer "{side}.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "MPR121" (at 0 {fmt(half + 1.5)}) (layer "{side}.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_line (start {fmt(-half)} {fmt(-half)}) (end {fmt(half)} {fmt(-half)}) (layer "{side}.Fab") (width 0.1))
    (fp_line (start {fmt(half)} {fmt(-half)}) (end {fmt(half)} {fmt(half)}) (layer "{side}.Fab") (width 0.1))
    (fp_line (start {fmt(half)} {fmt(half)}) (end {fmt(-half)} {fmt(half)}) (layer "{side}.Fab") (width 0.1))
    (fp_line (start {fmt(-half)} {fmt(half)}) (end {fmt(-half)} {fmt(-half)}) (layer "{side}.Fab") (width 0.1))
{chr(10).join(courtyard)}
    (fp_circle (center {fmt(-half + 0.5)} {fmt(-half + 0.5)}) (end {fmt(-half + 0.7)} {fmt(-half + 0.5)}) (layer "{side}.SilkS") (width 0.1))
{chr(10).join(pads)}
    (model "${{KICAD10_3DMODEL_DIR}}/Package_DFN_QFN.3dshapes/QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 0))
    )
  )"""


def all_sliders():
    """Generate both slider assemblies."""
    parts = []
    # Vertical slider: left of grid, pad 0 at bottom (near IC, close to H slider)
    vslider_nets = [net_vslider(7 - i) for i in range(8)]  # reversed so pad 0 = bottom
    parts.append(slider_assembly(
        MARGIN, ORIGIN_Y - PITCH / 2,
        vslider_nets, NET_MPR_IRQ_V, "U3", horizontal=False))
    # Horizontal slider: right half of bottom row, pad 0 on left (near V slider IC)
    hslider_nets = [net_hslider(i) for i in range(8)]
    parts.append(slider_assembly(
        ORIGIN_X + 8 * PITCH - PITCH / 2, ORIGIN_Y + ROWS * PITCH - PITCH / 2,
        hslider_nets, NET_MPR_IRQ_H, "U4", horizontal=True))
    return "\n".join(parts)


# ── Row 9: modifier keys + space bar ────────────────────────────────

ROW9_COLS = list(range(-1, 8))   # cols -1 through 7 (9 switches)

def row9_switches():
    """Bottom row switches wired into the matrix (cols -1..7, ROW8).
    Each switch has a diode, same as the main grid."""
    parts = []
    row = ROWS  # row index 8

    for i, col in enumerate(ROW9_COLS):
        cx, cy = cell_center(row, col)
        ref = f"SW_R09_C{col+2:02d}"  # col -1 → C01, col 0 → C02, etc.
        col_net = net_col(col + 1)  # shifted: col -1→COL0, col 0→COL1, etc.
        sw_net = net_r9_sw(i)

        # Switch footprint
        parts.append(f"""  (footprint "Arp3:Kailh_Choc_V1" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "Kailh Choc V1 bottom row key")
    (attr through_hole)
    (fp_text reference "{ref}" (at 0 -8.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (pad "1" thru_hole circle (at {fmt(SW_PAD1[0])} {fmt(SW_PAD1[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {col_net} {nn(col_net)}))
    (pad "2" thru_hole circle (at {fmt(SW_PAD2[0])} {fmt(SW_PAD2[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {sw_net} {nn(sw_net)}))
    (pad "" np_thru_hole circle (at 0 0) (size {fmt(SW_CENTER_DRILL)} {fmt(SW_CENTER_DRILL)}) (drill {fmt(SW_CENTER_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[0][0])} {fmt(SW_SIDE_POSTS[0][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[1][0])} {fmt(SW_SIDE_POSTS[1][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
    (model "${{KIPRJMOD}}/3dmodels/SW_Kailh_Choc_V1.stp"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 180))
    )
  )""")

        # Diode footprint (same layout as main grid)
        dx = cx + DIODE_OFFSET[0]
        dy = cy + DIODE_OFFSET[1]
        parts.append(f"""  (footprint "Arp3:D_SOD-323" (layer "F.Cu")
    (at {fmt(dx)} {fmt(dy)})
    (descr "1N4148W anti-ghosting diode SOD-323")
    (attr smd)
    (fp_text reference "D_R09_C{col+2:02d}" (at -2 0) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_line (start -0.5 {fmt(-DIODE_PAD_DY)}) (end 0.5 {fmt(-DIODE_PAD_DY)}) (layer "F.SilkS") (width 0.1))
    (pad "1" smd roundrect (at 0 {fmt(DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net {NET_ROW8} {nn(NET_ROW8)}))
    (pad "2" smd roundrect (at 0 {fmt(-DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net {sw_net} {nn(sw_net)}))
    (model "${{KICAD10_3DMODEL_DIR}}/Diode_SMD.3dshapes/D_SOD-323.step"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 90))
    )
  )""")

    return "\n".join(parts)


# ── Capacitive sliders ──────────────────────────────────────────────

SLIDER_PAD_GAP = 0.3      # gap between adjacent slider pads
SLIDER_TOOTH_AMP = 2.5    # zigzag amplitude
SLIDER_TOOTH_H = 2.5      # height of one zigzag tooth


def _zigzag(pos, lo, hi, n_teeth, amp, half_gap, vertical=True):
    """Zigzag boundary along one axis.

    If vertical=True: zigzag runs along X at a given Y (pos),
      from lo..hi in X. Returns (x, y) points.
    If vertical=False: zigzag runs along Y at a given X (pos),
      from lo..hi in Y. Returns (x, y) points.
    """
    pts = []
    span = hi - lo
    tw = span / max(n_teeth, 1)
    for i in range(n_teeth):
        a = lo + i * tw
        b = a + tw / 2.0
        if vertical:
            pts.append((a, pos - amp + half_gap))
            pts.append((b, pos + amp + half_gap))
        else:
            pts.append((pos - amp + half_gap, a))
            pts.append((pos + amp + half_gap, b))
    if vertical:
        pts.append((hi, pos - amp + half_gap))
    else:
        pts.append((pos - amp + half_gap, hi))
    return pts


def slider_assembly(origin_x, origin_y, pad_nets, irq_net, ref_prefix,
                    horizontal=False):
    """Generate a complete slider: 8 chevron pads on F.Cu + MPR121 + caps on B.Cu.

    Args:
        origin_x, origin_y: top-left corner of the slider area
        pad_nets: list of 8 net IDs for the electrode pads
        irq_net: net ID for the MPR121 IRQ output
        ref_prefix: reference prefix (e.g. "U3" for IC, "C3" for caps)
        horizontal: if False, pads run vertically (long axis = Y);
                    if True, pads run horizontally (long axis = X)

    Returns string of KiCad zones + footprints.
    """
    parts = []
    hg = SLIDER_PAD_GAP / 2

    if horizontal:
        # Pads tile along X, each PITCH wide, SLIDER_W tall
        sl_y0 = origin_y
        sl_y1 = origin_y + SLIDER_W
        n_teeth = int(SLIDER_W / SLIDER_TOOTH_H)
        # IC under last pad (pad 7), centered
        ic_x = origin_x + 7 * PITCH + PITCH / 2
        ic_y = origin_y + SLIDER_W / 2

        for i in range(8):
            net_id = pad_nets[i]
            net_name = nn(net_id)
            pad_x0 = origin_x + i * PITCH
            pad_x1 = pad_x0 + PITCH

            pts = []
            # Left edge: straight if first, zigzag otherwise
            if i == 0:
                pts.append((pad_x0, sl_y0))
                pts.append((pad_x0, sl_y1))
            else:
                pts.extend(_zigzag(pad_x0, sl_y0, sl_y1, n_teeth,
                                   SLIDER_TOOTH_AMP, +hg, vertical=False))
            # Right edge (reversed): straight if last, zigzag otherwise
            if i == 7:
                pts.append((pad_x1, sl_y1))
                pts.append((pad_x1, sl_y0))
            else:
                right = _zigzag(pad_x1, sl_y0, sl_y1, n_teeth,
                                SLIDER_TOOTH_AMP, -hg, vertical=False)
                right.reverse()
                pts.extend(right)

            xy_str = " ".join(f"(xy {fmt(x)} {fmt(y)})" for x, y in pts)
            parts.append(f"""  (zone (net {net_id}) (net_name {net_name}) (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {xy_str}))
    (filled_polygon (layer "F.Cu") (pts {xy_str}))
  )""")
    else:
        # Pads tile along Y, each PITCH tall, SLIDER_W wide
        sl_x0 = origin_x
        sl_x1 = origin_x + SLIDER_W
        n_teeth = int(SLIDER_W / SLIDER_TOOTH_H)
        # IC at bottom, centered under last pad
        ic_x = origin_x + SLIDER_W / 2
        ic_y = origin_y + 7 * PITCH + PITCH / 2

        for i in range(8):
            net_id = pad_nets[i]
            net_name = nn(net_id)
            pad_y0 = origin_y + i * PITCH
            pad_y1 = pad_y0 + PITCH

            pts = []
            # Top edge: straight if first, zigzag otherwise
            if i == 0:
                pts.append((sl_x0, pad_y0))
                pts.append((sl_x1, pad_y0))
            else:
                pts.extend(_zigzag(pad_y0, sl_x0, sl_x1, n_teeth,
                                   SLIDER_TOOTH_AMP, +hg, vertical=True))
            # Bottom edge (reversed): straight if last, zigzag otherwise
            if i == 7:
                pts.append((sl_x1, pad_y1))
                pts.append((sl_x0, pad_y1))
            else:
                bottom = _zigzag(pad_y1, sl_x0, sl_x1, n_teeth,
                                 SLIDER_TOOTH_AMP, -hg, vertical=True)
                bottom.reverse()
                pts.extend(bottom)

            xy_str = " ".join(f"(xy {fmt(x)} {fmt(y)})" for x, y in pts)
            parts.append(f"""  (zone (net {net_id}) (net_name {net_name}) (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {xy_str}))
    (filled_polygon (layer "F.Cu") (pts {xy_str}))
  )""")

    # MPR121 touch controller on B.Cu (under the slider pads)
    ic_ref = ref_prefix
    cap_base = int(ref_prefix[1]) + 1 if ref_prefix[1].isdigit() else 3
    pin_nets = {
        1: NET_VCC, 2: NET_GND, 3: 0,
        4: NET_I2C_SCL, 5: NET_I2C_SDA,
        6: irq_net,
        9: pad_nets[0], 10: pad_nets[1],
        11: NET_GND,
        12: pad_nets[2], 13: pad_nets[3],
        14: pad_nets[4], 15: pad_nets[5],
        16: pad_nets[6], 17: pad_nets[7],
        20: NET_VCC,
    }
    parts.append(mpr121_footprint(ic_x, ic_y, ic_ref, pin_nets, back=True))

    # Decoupling caps on B.Cu next to the IC
    parts.append(passive_0603(ic_x + 4, ic_y, f"C{cap_base}", "100nF",
                              NET_VCC, NET_GND, back=True))
    parts.append(passive_0603(ic_x + 4, ic_y + 2, f"C{cap_base + 1}", "100nF",
                              NET_VCC, NET_GND, back=True))

    # ESD protection: 4× PRTR5V0U2X (2 channels each) on B.Cu near the IC
    tvs_base = int(ref_prefix[1]) if ref_prefix[1].isdigit() else 3
    for t in range(4):
        tvs_x = ic_x - 4
        tvs_y = ic_y - 3 + t * 2.5
        parts.append(tvs_sot143b(
            tvs_x, tvs_y, f"D_TVS{tvs_base}_{t}",
            NET_GND, NET_VCC,
            pad_nets[t * 2], pad_nets[t * 2 + 1],
            back=True))

    return "\n".join(parts)


def board_outline():
    corners = [(0, 0), (BOARD_W, 0), (BOARD_W, BOARD_H), (0, BOARD_H)]
    lines = []
    for i in range(4):
        x1, y1 = corners[i]
        x2, y2 = corners[(i + 1) % 4]
        lines.append(f'  (gr_line (start {fmt(x1)} {fmt(y1)}) '
                     f'(end {fmt(x2)} {fmt(y2)}) '
                     f'(layer "Edge.Cuts") (width 0.1))')
    return "\n".join(lines)


def ground_zone():
    pts = (f"(xy 0 0) (xy {fmt(BOARD_W)} 0) "
           f"(xy {fmt(BOARD_W)} {fmt(BOARD_H)}) (xy 0 {fmt(BOARD_H)})")
    return f"""  (zone (net {NET_GND}) (net_name "GND") (layer "B.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {pts}))
  )"""


def vcc_zone_fcu():
    """VCC is trace-routed from power distribution, no zone needed."""
    return ""


def led_vcc_zone_fcu():
    """LED_VCC fill on F.Cu covering the grid area.

    LED VDD pads are SMD on F.Cu — connects directly without vias.
    """
    grid_left = ORIGIN_X - PITCH / 2
    grid_right = ORIGIN_X + (COLS - 1) * PITCH + PITCH / 2
    grid_top = ORIGIN_Y - PITCH / 2
    grid_bot = ORIGIN_Y + (ROWS - 1) * PITCH + PITCH / 2
    pts = (f"(xy {fmt(grid_left)} {fmt(grid_top)}) (xy {fmt(grid_right)} {fmt(grid_top)}) "
           f"(xy {fmt(grid_right)} {fmt(grid_bot)}) (xy {fmt(grid_left)} {fmt(grid_bot)})")
    return f"""  (zone (net {NET_LED_VCC}) (net_name "LED_VCC") (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {pts}))
  )"""


# ── Routing primitives ────────────────────────────────────────────────

TRACE_W = 0.25   # signal trace width (mm)
POWER_W = 0.5    # power trace width (mm)
VIA_SIZE = 0.8
VIA_DRILL = 0.4

# Column trace vertical trunk offset from switch center x.
# Must clear center post (radius 1.5 mm) and LED pads (edge at cx ± 1.55).
COL_TRUNK_DX = -2.5



def seg(x1, y1, x2, y2, width, layer, net_id):
    """Generate a KiCad trace segment."""
    return (f'  (segment (start {fmt(x1)} {fmt(y1)}) (end {fmt(x2)} {fmt(y2)}) '
            f'(width {fmt(width)}) (layer "{layer}") (net {net_id}) (tstamp {uuid()}))')


def via_hole(x, y, net_id):
    """Generate a KiCad via."""
    return (f'  (via (at {fmt(x)} {fmt(y)}) (size {fmt(VIA_SIZE)}) '
            f'(drill {fmt(VIA_DRILL)}) (layers "F.Cu" "B.Cu") '
            f'(net {net_id}) (tstamp {uuid()}))')


def chain_to_rc(idx):
    """Convert LED chain index (0-127) to (row, col)."""
    row = idx // COLS
    col_in_row = idx % COLS
    if row % 2 == 1:
        col = COLS - 1 - col_in_row
    else:
        col = col_in_row
    return (row, col)


# ── Routing generators ───────────────────────────────────────────────

def route_switch_to_diode():
    """F.Cu: short vertical trace from switch pad 2 to diode anode."""
    lines = []
    # Main grid (rows 0-7, cols 0-15)
    for r in range(ROWS):
        for c in range(COLS):
            cx, cy = cell_center(r, c)
            n = net_sw(r, c)
            sw2_x = cx + SW_PAD2[0]
            sw2_y = cy + SW_PAD2[1]
            anode_x = cx + DIODE_OFFSET[0]
            anode_y = cy + DIODE_OFFSET[1] - DIODE_PAD_DY
            lines.append(seg(sw2_x, sw2_y, anode_x, anode_y,
                             TRACE_W, "F.Cu", n))
    # Bottom row (row 8, cols -1..7)
    row = ROWS
    for i, col in enumerate(ROW9_COLS):
        cx, cy = cell_center(row, col)
        n = net_r9_sw(i)
        sw2_x = cx + SW_PAD2[0]
        sw2_y = cy + SW_PAD2[1]
        anode_x = cx + DIODE_OFFSET[0]
        anode_y = cy + DIODE_OFFSET[1] - DIODE_PAD_DY
        lines.append(seg(sw2_x, sw2_y, anode_x, anode_y,
                         TRACE_W, "F.Cu", n))
    return "\n".join(lines)


def route_columns():
    """F.Cu: vertical column bus with horizontal stubs to each switch pad 1.

    Trunk runs at cx + COL_TRUNK_DX to clear the center post (3 mm drill at
    switch center).  Horizontal stubs connect the trunk to pad 1 at (cx, cy+5.9).
    """
    lines = []
    for c in range(COLS):
        n = net_col(c)
        cx = ORIGIN_X + c * PITCH
        trunk_x = cx + COL_TRUNK_DX
        has_bottom = c <= 8
        d = CHAMFER

        for r in range(ROWS):
            cy = ORIGIN_Y + r * PITCH
            pad_y = cy + SW_PAD1[1]

            if r < ROWS - 1:
                # Normal row: stub → chamfer into trunk → vertical → chamfer out
                lines.append(seg(cx, pad_y, trunk_x + d, pad_y, TRACE_W, "F.Cu", n))
                lines.append(seg(trunk_x + d, pad_y, trunk_x, pad_y + d,
                                 TRACE_W, "F.Cu", n))
                next_pad_y = ORIGIN_Y + (r + 1) * PITCH + SW_PAD1[1]
                lines.append(seg(trunk_x, pad_y + d, trunk_x, next_pad_y - d,
                                 TRACE_W, "F.Cu", n))
                lines.append(seg(trunk_x, next_pad_y - d, trunk_x + d, next_pad_y,
                                 TRACE_W, "F.Cu", n))
            elif has_bottom:
                # Last main row, connects to bottom row
                r9_cx = ORIGIN_X + (c - 1) * PITCH
                r9_pad_y = ORIGIN_Y + ROWS * PITCH + SW_PAD1[1]

                # Stub into trunk with chamfer
                lines.append(seg(cx, pad_y, trunk_x + d, pad_y, TRACE_W, "F.Cu", n))
                lines.append(seg(trunk_x + d, pad_y, trunk_x, pad_y + d,
                                 TRACE_W, "F.Cu", n))

                if c == 8:
                    # COL8: trunk overlaps horizontal slider — via to B.Cu
                    via_y = pad_y + d + 2.375  # clears row trace, avoids touchstrip
                    lines.append(seg(trunk_x, pad_y + d, trunk_x, via_y,
                                     TRACE_W, "F.Cu", n))
                    lines.append(via_hole(trunk_x, via_y, n))
                    # B.Cu: vertical down to match other columns, then to pad
                    vert_end_y = pad_y + d + 7.625  # same Y as cols 0-7
                    lines.append(seg(trunk_x, via_y, trunk_x, vert_end_y,
                                     TRACE_W, "B.Cu", n))
                    lines.append(seg(trunk_x, vert_end_y, r9_cx, r9_pad_y,
                                     TRACE_W, "B.Cu", n))
                    lines.append(via_hole(r9_cx, r9_pad_y, n))
                else:
                    # Cols 0-7: vertical past holes, then straight line to pad
                    vert_len = 7.625  # clears center post + side posts
                    diag_start_y = pad_y + d + vert_len
                    lines.append(seg(trunk_x, pad_y + d, trunk_x, diag_start_y,
                                     TRACE_W, "F.Cu", n))
                    lines.append(seg(trunk_x, diag_start_y, r9_cx, r9_pad_y,
                                     TRACE_W, "F.Cu", n))
            else:
                # Last row, no bottom row: straight stub
                lines.append(seg(cx, pad_y, trunk_x, pad_y, TRACE_W, "F.Cu", n))
    return "\n".join(lines)


def route_rows():
    """B.Cu: horizontal row bus connecting diode cathodes via vias.

    Via at each diode cathode pad (F.Cu SMD) drops to B.Cu.  Horizontal trace
    on B.Cu links all cathodes in the same row.
    """
    lines = []
    # Main grid rows 0-7 (16 columns each)
    for r in range(ROWS):
        n = net_row(r)
        cy = ORIGIN_Y + r * PITCH
        via_y = cy + DIODE_OFFSET[1] + DIODE_PAD_DY

        for c in range(COLS):
            cx = ORIGIN_X + c * PITCH
            via_x = cx + DIODE_OFFSET[0]
            lines.append(via_hole(via_x, via_y, n))
            if c < COLS - 1:
                next_x = ORIGIN_X + (c + 1) * PITCH + DIODE_OFFSET[0]
                lines.append(seg(via_x, via_y, next_x, via_y,
                                 TRACE_W, "B.Cu", n))

        # Extend row bus past last column
        last_via_x = ORIGIN_X + (COLS - 1) * PITCH + DIODE_OFFSET[0]
        grid_right = ORIGIN_X + (COLS - 1) * PITCH + PITCH / 2
        lines.append(seg(last_via_x, via_y, grid_right, via_y,
                         TRACE_W, "B.Cu", n))

    # Bottom row (ROW8, cols -1..7)
    n = NET_ROW8
    cy = ORIGIN_Y + ROWS * PITCH
    via_y = cy + DIODE_OFFSET[1] + DIODE_PAD_DY
    for i, col in enumerate(ROW9_COLS):
        cx = ORIGIN_X + col * PITCH
        via_x = cx + DIODE_OFFSET[0]
        lines.append(via_hole(via_x, via_y, n))
        if i < len(ROW9_COLS) - 1:
            next_col = ROW9_COLS[i + 1]
            next_x = ORIGIN_X + next_col * PITCH + DIODE_OFFSET[0]
            lines.append(seg(via_x, via_y, next_x, via_y,
                             TRACE_W, "B.Cu", n))
    return "\n".join(lines)


def route_led_chain():
    """B.Cu: LED data chain via vias at DOUT/DIN pads.

    Pads are SMD on F.Cu, so vias drop to B.Cu for routing.
    Intra-row: horizontal + 45° diagonal on B.Cu.
    Inter-row: diagonal-vertical-diagonal between alignment holes on B.Cu.
    """
    lines = []

    total = ROWS * COLS
    for n in range(total - 1):
        src_r, src_c = chain_to_rc(n)
        dst_r, dst_c = chain_to_rc(n + 1)
        src_cx, src_cy = cell_center(src_r, src_c)
        dst_cx, dst_cy = cell_center(dst_r, dst_c)

        # Pad positions depend on row orientation (odd rows rotated 180°)
        src_s = 1 if src_r % 2 == 0 else -1
        dst_s = 1 if dst_r % 2 == 0 else -1
        # DOUT pad (pin 2): LED center + (s*DX, -s*DY)
        dout_x = src_cx + LED_OFFSET[0] + src_s * LED_PAD_DX
        dout_y = src_cy + LED_OFFSET[1] - src_s * LED_PAD_DY
        # DIN pad (pin 4): LED center + (-s*DX, s*DY)
        din_x = dst_cx + LED_OFFSET[0] - dst_s * LED_PAD_DX
        din_y = dst_cy + LED_OFFSET[1] + dst_s * LED_PAD_DY

        chain_n = net_led_chain(n + 1)

        # Vias at DOUT and DIN pads (F.Cu SMD → B.Cu)
        lines.append(via_hole(dout_x, dout_y, chain_n))
        lines.append(via_hole(din_x, din_y, chain_n))

        # Y difference between DOUT and DIN pads
        dy = din_y - dout_y

        if src_r == dst_r:
            # ── Intra-row: horizontal + 45° diagonal on B.Cu ──
            if din_x > dout_x:
                # Even row (L→R): 45° diagonal from DOUT, then horizontal to DIN
                diag_end_x = dout_x + abs(dy)
                lines.append(seg(dout_x, dout_y, diag_end_x, din_y,
                                 TRACE_W, "B.Cu", chain_n))
                lines.append(seg(diag_end_x, din_y, din_x, din_y,
                                 TRACE_W, "B.Cu", chain_n))
            else:
                # Odd row (R→L): horizontal from DOUT, then 45° diagonal to DIN
                diag_start_x = din_x + abs(dy)
                lines.append(seg(dout_x, dout_y, diag_start_x, dout_y,
                                 TRACE_W, "B.Cu", chain_n))
                lines.append(seg(diag_start_x, dout_y, din_x, din_y,
                                 TRACE_W, "B.Cu", chain_n))
        else:
            # ── Inter-row: diagonal-vertical-diagonal between alignment holes ──
            if src_c == COLS - 1:
                channel_x = src_cx + 3.0   # right side: between center and right post
            else:
                channel_x = src_cx - 3.5   # left side: between col trunk (-2.5) and left post (-4.55)
            dx = abs(channel_x - dout_x)
            top_y = dout_y + dx
            bot_y = din_y - dx

            if src_c == COLS - 1:
                # Right side: entirely on F.Cu (no B.Cu row traces to cross)
                lines.append(seg(dout_x, dout_y, channel_x, top_y,
                                 TRACE_W, "F.Cu", chain_n))
                lines.append(seg(channel_x, top_y, channel_x, bot_y,
                                 TRACE_W, "F.Cu", chain_n))
                lines.append(seg(channel_x, bot_y, din_x, din_y,
                                 TRACE_W, "F.Cu", chain_n))
            else:
                # Left side: B.Cu with via to F.Cu to skip source row's bus
                row_bus_y = src_cy + DIODE_OFFSET[1] + DIODE_PAD_DY
                via_margin = 1.0  # clearance from row bus
                via_above = row_bus_y - via_margin
                via_below = row_bus_y + via_margin
                # \ diagonal on B.Cu
                lines.append(seg(dout_x, dout_y, channel_x, top_y,
                                 TRACE_W, "B.Cu", chain_n))
                # | vertical on B.Cu to just above row bus
                lines.append(seg(channel_x, top_y, channel_x, via_above,
                                 TRACE_W, "B.Cu", chain_n))
                # Via to F.Cu, cross row bus, via back to B.Cu
                lines.append(via_hole(channel_x, via_above, chain_n))
                lines.append(seg(channel_x, via_above, channel_x, via_below,
                                 TRACE_W, "F.Cu", chain_n))
                lines.append(via_hole(channel_x, via_below, chain_n))
                # | continue on B.Cu
                lines.append(seg(channel_x, via_below, channel_x, bot_y,
                                 TRACE_W, "B.Cu", chain_n))
                # / diagonal on B.Cu
                lines.append(seg(channel_x, bot_y, din_x, din_y,
                                 TRACE_W, "B.Cu", chain_n))
    return "\n".join(lines)


def route_led_gnd():
    """Via at each LED GND pad → B.Cu ground fill."""
    lines = []
    for r in range(ROWS):
        s = 1 if r % 2 == 0 else -1
        for c in range(COLS):
            cx, cy = cell_center(r, c)
            gnd_x = cx + LED_OFFSET[0] + s * LED_PAD_DX   # GND pad (pin 3)
            gnd_y = cy + LED_OFFSET[1] + s * LED_PAD_DY
            lines.append(via_hole(gnd_x, gnd_y, NET_GND))
    return "\n".join(lines)


def route_led_vcc():
    """LED VDD pads connect directly to F.Cu LED_VCC zone — no vias needed."""
    return ""


# ── Connector routing (right side) ──────────────────────────────────

CONN_FANIN_SPACING = 0.4  # spacing between fan-in traces (tight to fit before Teensy)
CHAMFER = 0.6              # 45° chamfer distance at corners


def chamfer_route(waypoints, width, layer, net_id, chamfer=CHAMFER):
    """Generate trace segments with 45° chamfers at every corner.

    Each 90° turn is replaced by two 45° bends: the route pulls back
    `chamfer` mm along the incoming segment, crosses diagonally, then
    continues `chamfer` mm into the outgoing segment.
    """
    pts = list(waypoints)
    out = [pts[0]]

    for i in range(1, len(pts) - 1):
        px, py = pts[i - 1]
        cx, cy = pts[i]
        nx, ny = pts[i + 1]

        # Incoming / outgoing unit vectors
        dx1, dy1 = cx - px, cy - py
        dx2, dy2 = nx - cx, ny - cy
        len1 = (dx1**2 + dy1**2) ** 0.5
        len2 = (dx2**2 + dy2**2) ** 0.5

        if len1 == 0 or len2 == 0:
            out.append((cx, cy))
            continue

        d = min(chamfer, len1 * 0.45, len2 * 0.45)
        ux1, uy1 = dx1 / len1, dy1 / len1
        ux2, uy2 = dx2 / len2, dy2 / len2

        out.append((cx - ux1 * d, cy - uy1 * d))  # before corner
        out.append((cx + ux2 * d, cy + uy2 * d))  # after corner

    out.append(pts[-1])

    segs = []
    for i in range(len(out) - 1):
        x1, y1 = out[i]
        x2, y2 = out[i + 1]
        segs.append(seg(x1, y1, x2, y2, width, layer, net_id))
    return segs


def route_conn_rows():
    """Row buses already end at vias on B.Cu at each diode cathode.
    Manual routing from the last via in each row to U2 QFN pins."""
    return ""


COLS_PER_GAP = 4   # columns routed through each inter-row gap
GAP_Y_SPACING = 1.0  # Y spacing between traces in the same gap


def route_conn_cols():
    """Column-to-U1 routing — placeholder, to be redesigned."""
    return ""


def route_usb_to_teensy():
    """Route USB-C signals to Teensy and power distribution components.

    USB-C → CC resistors (short stubs)
    USB-C → C7 VBUS decoupling
    USB-C → F1 polyfuse → VCC_FUSED → R5 → LED_VCC
                                     → FB1 → VCC → C9
    VCC connects to Teensy Vin via F.Cu zone fill.
    USB D+/D- → Teensy USB pads (not yet connected — Teensy has its own USB).
    """
    lines = []
    pwr_x = USB_X
    pwr_y = USB_Y + 10
    d = CHAMFER

    # ── USB-C VBUS (A4 at USB_X + 0.25, A9 at USB_X + 2.75) to C7 ──
    # VBUS pad A4 is at USB_X + (-2.75 + 3*0.5) = USB_X - 1.25
    # VBUS pad A9 is at USB_X + (-2.75 + 8*0.5) = USB_X + 1.25
    vbus_a4_x = USB_X - 1.25
    vbus_a9_x = USB_X + 1.25
    # Merge VBUS pads into a single trace down to C7
    c7_x = USB_X
    c7_y = USB_Y + 7
    lines.append(seg(vbus_a4_x, USB_Y, vbus_a4_x, USB_Y + 2,
                     POWER_W, "F.Cu", NET_USB_VBUS))
    lines.append(seg(vbus_a9_x, USB_Y, vbus_a9_x, USB_Y + 2,
                     POWER_W, "F.Cu", NET_USB_VBUS))
    lines.append(seg(vbus_a4_x, USB_Y + 2, vbus_a9_x, USB_Y + 2,
                     POWER_W, "F.Cu", NET_USB_VBUS))
    # Down to C7
    lines.append(seg(c7_x, USB_Y + 2, c7_x, c7_y - P0603_PAD_DX,
                     POWER_W, "F.Cu", NET_USB_VBUS))

    # ── C7 to F1 (VBUS → polyfuse) ──
    f1_x = pwr_x
    f1_y = pwr_y
    lines.append(seg(c7_x, c7_y - P0603_PAD_DX, f1_x - P0603_PAD_DX, f1_y,
                     POWER_W, "F.Cu", NET_USB_VBUS))

    # ── F1 output (VCC_FUSED) to R5 and FB1 ──
    r5_x = pwr_x
    r5_y = pwr_y + 3
    fb1_x = pwr_x + 3
    fb1_y = pwr_y + 3
    # F1 pad 2 to junction
    lines.append(seg(f1_x + P0603_PAD_DX, f1_y, f1_x + P0603_PAD_DX, r5_y,
                     POWER_W, "F.Cu", NET_VCC_FUSED))
    # Junction to R5 pad 1
    lines.append(seg(f1_x + P0603_PAD_DX, r5_y, r5_x - P0603_PAD_DX, r5_y,
                     POWER_W, "F.Cu", NET_VCC_FUSED))
    # Junction to FB1 pad 1
    lines.append(seg(f1_x + P0603_PAD_DX, r5_y, fb1_x - P0603_PAD_DX, fb1_y,
                     POWER_W, "F.Cu", NET_VCC_FUSED))

    # ── FB1 output (VCC) to C9 ──
    c9_x = pwr_x + 3
    c9_y = pwr_y + 5
    lines.append(seg(fb1_x + P0603_PAD_DX, fb1_y, c9_x + P0603_PAD_DX, c9_y,
                     POWER_W, "F.Cu", NET_VCC))

    # ── CC1/CC2 from USB-C to resistors (short stubs down) ──
    # CC1 pad A5 at USB_X + (-2.75 + 4*0.5) = USB_X - 0.75
    # CC2 would be on B-side, but we only have A-side pads
    cc1_x = USB_X - 0.75
    r3_x = USB_X - 2
    r3_y = USB_Y + 5
    lines.append(seg(cc1_x, USB_Y, cc1_x, USB_Y + 3,
                     TRACE_W, "F.Cu", NET_USB_CC1))
    lines.append(seg(cc1_x, USB_Y + 3, r3_x - P0603_PAD_DX, r3_y,
                     TRACE_W, "F.Cu", NET_USB_CC1))

    # CC2 — A5 only has CC1 for single-orientation. CC2 from B-side
    # For now, R4 connects CC2 to GND via its own net
    r4_x = USB_X + 2
    r4_y = USB_Y + 5

    # ── USB D+/D- from USB-C to wire pads near Teensy ──
    # Route on B.Cu to avoid power components on F.Cu
    # D+ pad A6 at USB_X - 0.25, D- pad A7 at USB_X + 0.25
    dp_x = USB_X - 0.25
    dn_x = USB_X + 0.25
    # Wire pad positions (horizontal, between power and Teensy)
    usb_dev_dp_x = USB_X - TEENSY_PITCH / 2
    usb_dev_dn_x = USB_X + TEENSY_PITCH / 2
    usb_dev_y = 19.0

    # D+: short F.Cu stub from pad, via to B.Cu, route under power, via back
    lines.append(seg(dp_x, USB_Y, dp_x, USB_Y + 1.5,
                     TRACE_W, "F.Cu", NET_USB_DP))
    lines.append(via_hole(dp_x, USB_Y + 1.5, NET_USB_DP))
    lines.append(seg(dp_x, USB_Y + 1.5, usb_dev_dp_x, usb_dev_y,
                     TRACE_W, "B.Cu", NET_USB_DP))
    lines.append(via_hole(usb_dev_dp_x, usb_dev_y, NET_USB_DP))

    # D-: same pattern
    lines.append(seg(dn_x, USB_Y, dn_x, USB_Y + 1.5,
                     TRACE_W, "F.Cu", NET_USB_DN))
    lines.append(via_hole(dn_x, USB_Y + 1.5, NET_USB_DN))
    lines.append(seg(dn_x, USB_Y + 1.5, usb_dev_dn_x, usb_dev_y,
                     TRACE_W, "B.Cu", NET_USB_DN))
    lines.append(via_hole(usb_dev_dn_x, usb_dev_y, NET_USB_DN))

    return "\n".join(lines)


def route_gnd_vias():
    """GND vias at F.Cu SMD pads that need to reach the B.Cu ground zone."""
    lines = []
    pwr_x = USB_X
    pwr_y = USB_Y + 10

    # C1 (MCP U1 decoupling) — GND is pad 2 (right, +DX)
    lines.append(via_hole(U1_X + P0603_PAD_DX, U1_Y + 5, NET_GND))
    # C2 (MCP U2 decoupling) — GND is pad 2 (right, +DX)
    lines.append(via_hole(U2_X + P0603_PAD_DX, U2_Y - 5, NET_GND))
    # R3 (CC1 pull-down) — GND is pad 2 (right, +DX)
    lines.append(via_hole(USB_X - 2 + P0603_PAD_DX, USB_Y + 5, NET_GND))
    # R4 (CC2 pull-down) — GND is pad 2 (right, +DX)
    lines.append(via_hole(USB_X + 2 + P0603_PAD_DX, USB_Y + 5, NET_GND))
    # C7 (VBUS decoupling) — GND is pad 2 (right, +DX)
    lines.append(via_hole(USB_X + P0603_PAD_DX, USB_Y + 7, NET_GND))
    # C8 (LED bulk cap) — GND is pad 2 (right, +DX)
    lines.append(via_hole(pwr_x - 3 + P0603_PAD_DX, pwr_y + 3, NET_GND))
    # C9 (VCC decoupling, flipped) — GND is pad 1 (left, -DX)
    lines.append(via_hole(pwr_x + 3 - P0603_PAD_DX, pwr_y + 5, NET_GND))

    return "\n".join(lines)


def route_conn_led_din():
    """LED_DIN from first LED to Teensy pin 1."""
    return ""


# ── Main output ───────────────────────────────────────────────────────

def generate():
    nets = all_net_names()
    net_defs = "\n".join(f'  (net {nid} {nm})' for nid, nm in nets)

    # Generate all footprints
    switches = []
    diodes = []
    leds = []
    for r in range(ROWS):
        for c in range(COLS):
            switches.append(switch_footprint(r, c))
            diodes.append(diode_footprint(r, c))
            leds.append(led_footprint(r, c))

    all_switches = "\n".join(switches)
    all_diodes = "\n".join(diodes)
    all_leds = "\n".join(leds)

    # Generate routing
    routing_sw_diode = route_switch_to_diode()
    routing_cols = route_columns()
    routing_rows = route_rows()
    routing_led_chain = route_led_chain()
    routing_led_gnd = route_led_gnd()
    routing_led_vcc = route_led_vcc()
    routing_conn_rows = route_conn_rows()
    routing_conn_cols = route_conn_cols()
    routing_usb = route_usb_to_teensy()
    routing_gnd_vias = route_gnd_vias()
    routing_conn_led_din = route_conn_led_din()

    return f"""(kicad_pcb (version 20240108) (generator "arp3_grid_gen")

  (general
    (thickness 1.6)
  )

  (paper "A3")

  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user "B.Mask")
    (39 "F.Mask" user "F.Mask")
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (42 "Eco1.User" user "User.Eco1")
    (43 "Eco2.User" user "User.Eco2")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user "B.Fab")
    (49 "F.Fab" user "F.Fab")
  )

  (setup
    (pad_to_mask_clearance 0.05)
    (aux_axis_origin 0 0)
    (pcbplotparams
      (layerselection 0x00010fc_ffffffff)
      (plotframeref no)
      (viasonmask no)
      (mode 1)
      (useauxorigin no)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (outputformat 1)
      (mirror no)
      (drillshape 1)
      (scaleselection 1)
      (outputdirectory "")
    )
  )

{net_defs}

{board_outline()}

{all_switches}

{all_diodes}

{all_leds}

{mcp_components()}

{row9_switches()}

{all_sliders()}

{routing_sw_diode}

{routing_cols}

{routing_rows}

{routing_led_chain}

{routing_led_gnd}

{routing_led_vcc}

{routing_conn_rows}

{routing_conn_cols}

{routing_usb}

{routing_gnd_vias}

{routing_conn_led_din}

{ground_zone()}

{vcc_zone_fcu()}

{led_vcc_zone_fcu()}

)
"""


def generate_bom():
    """Generate a Bill of Materials in Markdown format with store links."""
    bom = []
    bom.append("# Bill of Materials")
    bom.append("")
    bom.append(f"Generated: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}")
    bom.append("")
    bom.append("| Qty | Reference | Value | Package | Description | Where to buy |")
    bom.append("|-----|-----------|-------|---------|-------------|-------------|")

    grid_sw = ROWS * COLS
    r9_sw = len(ROW9_COLS)
    total = grid_sw + r9_sw

    bom.append(f"| {total} | SW_R01_C01-R{ROWS:02d}_C{COLS:02d}, SW_R09_C01-C{r9_sw:02d} | PG1350 | Kailh Choc V1 "
               f"| Low-profile keyswitch "
               f"| [splitkb.com](https://splitkb.com/products/kailh-low-profile-choc-switches) |")

    bom.append(f"| {total} | D_R01_C01-R{ROWS:02d}_C{COLS:02d}, D_R09_C01-C{r9_sw:02d} | 1N4148W | SOD-323 "
               f"| Anti-ghosting diode "
               f"| [tme.eu](https://www.tme.eu/en/details/1n4148w-dc/smd-universal-diodes/) · "
               f"[reichelt.de](https://www.reichelt.de/index.html?ACTION=446&q=1N4148W%20SOD-323) · "
               f"[lcsc.com](https://www.lcsc.com/search?q=1N4148W%20SOD-323) |")

    bom.append(f"| {grid_sw} | LED_R01_C01-R{ROWS:02d}_C{COLS:02d} | SK6812MINI-E | 3535 "
               f"| RGB addressable LED "
               f"| [splitkb.com](https://splitkb.com/products/sk6812mini-e-rgb-leds) · "
               f"[lcsc.com](https://www.lcsc.com/search?q=SK6812MINI-E) |")

    bom.append("| 2 | U1, U2 | MCP23S17-E/ML | QFN-28 6x6mm "
               "| SPI 16-bit I/O expander "
               "| [tme.eu](https://www.tme.eu/en/details/mcp23s17-e_ml/spi-periph-integrated-circuits/microchip-technology/) · "
               "[reichelt.de](https://www.reichelt.de/index.html?ACTION=446&q=MCP23S17-E%2FML) · "
               "[lcsc.com](https://www.lcsc.com/search?q=MCP23S17-E%2FML) |")

    bom.append("| 2 | U3, U4 | MPR121QR2 | QFN-20 4x4mm "
               "| Capacitive touch controller "
               "| [tme.eu](https://www.tme.eu/en/details/mpr121qr2/capacitance-to-digital-converters/nxp/) · "
               "[lcsc.com](https://www.lcsc.com/search?q=MPR121QR2) · "
               "[nl.mouser.com](https://nl.mouser.com/ProductDetail/NXP-Semiconductors/MPR121QR2) |")

    bom.append("| 8 | D_TVS3_0-3, D_TVS4_0-3 | PRTR5V0U2X | SOT-143B "
               "| Dual ESD protection TVS "
               "| [tme.eu](https://www.tme.eu/en/details/prtr5v0u2x.215/esd-suppressors-smd/nexperia/) · "
               "[lcsc.com](https://www.lcsc.com/search?q=PRTR5V0U2X) · "
               "[reichelt.de](https://www.reichelt.de/index.html?ACTION=446&q=PRTR5V0U2X) |")

    bom.append("| 1 | U5 | Teensy 4.1 | DIP-48 "
               "| ARM Cortex-M7 MCU "
               "| [tinytronics.nl](https://www.tinytronics.nl/en/development-boards/microcontroller-boards/teensy/teensy-4.1) · "
               "[kiwi-electronics.nl](https://www.kiwi-electronics.nl/en/search?search=teensy+4.1) |")

    bom.append("| 1 | DISP1 | ILI9341 | 2.4in TFT module "
               "| 320x240 SPI display "
               "| [tinytronics.nl](https://www.tinytronics.nl/en/displays/tft/2.4-inch-tft-display-240*320-pixels-with-touchscreen-spi-ili9341) · "
               "[opencircuit.nl](https://www.opencircuit.nl/search?search=ILI9341+2.4) |")

    bom.append("| 1 | J1 | USB4110-GF-A | USB-C mid-mount "
               "| USB Type-C receptacle "
               "| [lcsc.com](https://www.lcsc.com/search?q=USB4110-GF-A) · "
               "[nl.mouser.com](https://nl.mouser.com/ProductDetail/GCT/USB4110-GF-A) |")

    bom.append("| 1 | F1 | 1206L200 | 1206 "
               "| 2A resettable polyfuse "
               "| [tme.eu](https://www.tme.eu/en/details/1206l200/polymer-ptc-fuses-smd/littelfuse/) · "
               "[lcsc.com](https://www.lcsc.com/search?q=1206L200) · "
               "[reichelt.de](https://www.reichelt.de/index.html?ACTION=446&q=1206L200) |")

    bom.append("| 1 | FB1 | BLM18AG601SN1D | 0603 "
               "| Ferrite bead 600R@100MHz "
               "| [tme.eu](https://www.tme.eu/en/details/blm18ag601sn1d/ferrite-smd-beads/murata/) · "
               "[reichelt.de](https://www.reichelt.de/index.html?ACTION=446&q=BLM18AG601SN1D) · "
               "[lcsc.com](https://www.lcsc.com/search?q=BLM18AG601SN1D) |")

    bom.append("| 1 | R5 | 0R | 0603 "
               "| LED power jumper "
               "| [tme.eu](https://www.tme.eu/en/katalog/smd-resistors_112313/?params=2:498;18:1403) · "
               "[lcsc.com](https://www.lcsc.com/search?q=0603%200R) |")

    bom.append("| 2 | R1, R2 | 4.7k | 0603 "
               "| I2C pull-up resistor (MPR121) "
               "| [tme.eu](https://www.tme.eu/en/katalog/smd-resistors_112313/?params=2:498;6:4.7k) · "
               "[lcsc.com](https://www.lcsc.com/search?q=0603%204.7k) |")

    bom.append("| 2 | R3, R4 | 5.1k | 0603 "
               "| USB-C CC pull-down "
               "| [tme.eu](https://www.tme.eu/en/katalog/smd-resistors_112313/?params=2:498;6:5.1k) · "
               "[lcsc.com](https://www.lcsc.com/search?q=0603%205.1k) |")

    bom.append("| 6 | C1-C6 | 100nF | 0603 "
               "| Decoupling cap (MCP23S17/MPR121) "
               "| [tme.eu](https://www.tme.eu/en/katalog/mlcc-smd-capacitors_112316/?params=2:498;4:100n) · "
               "[lcsc.com](https://www.lcsc.com/search?q=0603%20100nF) |")

    bom.append("| 2 | C7, C9 | 10uF | 0603 "
               "| Decoupling cap (USB/VCC) "
               "| [tme.eu](https://www.tme.eu/en/katalog/mlcc-smd-capacitors_112316/?params=2:498;4:10u) · "
               "[lcsc.com](https://www.lcsc.com/search?q=0603%2010uF) |")

    bom.append("| 1 | C8 | 100uF | 1210 "
               "| LED bulk capacitor "
               "| [lcsc.com](https://www.lcsc.com/search?q=1210%20100uF) · "
               "[nl.mouser.com](https://nl.mouser.com/c/?q=1210%20100uF%20MLCC) |")

    bom.append("")

    n_parts = total * 2 + grid_sw + 2 + 2 + 8 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 8 + 1
    bom.append(f"**Total components:** {n_parts}")
    bom.append("")

    bom.append("## Notes")
    bom.append("")
    bom.append("- **EU stores** (no customs): "
               "[tme.eu](https://www.tme.eu) (PL), "
               "[reichelt.de](https://www.reichelt.de) (DE), "
               "[farnell.nl](https://www.farnell.nl) (EU)")
    bom.append("- **NL stores**: "
               "[splitkb.com](https://splitkb.com) (keyboard parts), "
               "[tinytronics.nl](https://www.tinytronics.nl), "
               "[opencircuit.nl](https://www.opencircuit.nl), "
               "[kiwi-electronics.nl](https://www.kiwi-electronics.nl)")
    bom.append("- **Other**: "
               "[lcsc.com](https://www.lcsc.com) (CN, cheap SMD), "
               "[nl.mouser.com](https://nl.mouser.com) (US, ships from Texas)")
    bom.append("- **F1**: 2A PTC fuse needs 1206 package (0603 maxes out ~200mA)")
    bom.append("- **C8**: 100uF MLCC needs 1210 package (0603 maxes out ~22uF)")
    bom.append("- **SK6812MINI-E**: RGB only (not RGBW). RGBW variant available on AliExpress/LCSC")
    bom.append("- **LED_VCC** rail separate from **VCC** — VBUS through polyfuse to LEDs, "
               "ferrite-filtered for Teensy/ICs")
    bom.append("- **PCB finish**: ENIG recommended for capacitive touch slider pads")
    bom.append("- **TVS diodes** protect all 16 slider electrode lines against ESD")
    bom.append("")

    return "\n".join(bom)


if __name__ == "__main__":
    sys.stdout.write(generate())

    # Generate BOM alongside PCB
    import os
    bom_path = os.path.join(os.path.dirname(__file__) or ".", "bom.md")
    with open(bom_path, "w") as f:
        f.write(generate_bom())
    print(f"\nBOM written to {bom_path}", file=sys.stderr)
