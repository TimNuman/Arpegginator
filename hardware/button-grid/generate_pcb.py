#!/usr/bin/env python3
"""Generate a KiCad 7 PCB for the Arpegginator 16×8 button grid.

Components per cell:
  - Kailh Choc v1 (PG1350) low-profile switch
  - 1N4148W (SOD-323) anti-ghosting diode
  - SK6812MINI-E (3535) RGBW addressable LED

Matrix: 16 columns × 8 rows, scanned with 24 GPIO pins.
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
CONN_AREA_W = 22.0                              # extra width for Teensy + MCP area
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
SW_PAD2 = (5.0, 3.8)     # right electrical pin
SW_PAD_DRILL = 1.2
SW_PAD_SIZE = 2.2
SW_CENTER_DRILL = 3.0     # center alignment post (NPTH)
SW_SIDE_POSTS = [(-5.22, 0), (5.22, 0)]  # side alignment (NPTH)
SW_SIDE_DRILL = 1.7

# ── 1N4148W diode (SOD-323) ──────────────────────────────────────────
# Placed to the right of the switch, connecting SW_PAD2 to the row line.
# Anode at top (connects to switch pad 2), cathode at bottom (connects to row).
DIODE_OFFSET = (5.0, 7.0)   # relative to switch center
DIODE_PAD_DY = 0.95          # half-spacing between pads (vertical)
DIODE_PAD_W = 0.8
DIODE_PAD_H = 0.6

# ── SK6812MINI-E RGBW LED (3535) ─────────────────────────────────────
# Placed at switch center (shines through/around keycap)
LED_OFFSET = (0, -2.5)      # slightly above switch center, clear of post
LED_PAD_DX = 1.2             # half-spacing horizontal
LED_PAD_DY = 0.8             # half-spacing vertical
LED_PAD_W = 0.7
LED_PAD_H = 0.7
# Pin 1=VDD (TL), Pin 2=DOUT (TR), Pin 3=GND (BR), Pin 4=DIN (BL)

# ── MCP23017 I/O Expanders (QFN-28, 6×6mm) ─────────────────────────
# QFN-28: 7 pins per side, 0.65mm pitch, pad center 3.0mm from chip center
QFN_PAD_EDGE = 3.0              # pad center distance from chip center
QFN_PAD_PITCH = 0.65            # pin pitch
QFN_PAD_W = 0.35                # pad width (along edge)
QFN_PAD_H = 0.8                 # pad height (perpendicular to edge)
QFN_PINS_PER_SIDE = 7

# QFN rotation: 0° (standard orientation on right side)
QFN_ROTATION = 0

# Teensy 4.1 header (2 rows of 24, 600mil DIP, USB at top, mounted on back)
TEENSY_DX = 7.62               # half row spacing (15.24mm / 2)
TEENSY_X = BOARD_W - MARGIN - TEENSY_DX - 1.0
TEENSY_Y = MARGIN               # first pin aligned to top of board
TEENSY_PITCH = 2.54
TEENSY_PINS = 24
TEENSY_PAD_DRILL = 1.0
TEENSY_PAD_SIZE = 1.7
TEENSY_LAST_Y = TEENSY_Y + (TEENSY_PINS - 1) * TEENSY_PITCH

# U1 = column expander (right side, below Teensy)
# U2 = row expander (right side, near bottom)
U1_X = TEENSY_X - TEENSY_DX + 3.0   # near Teensy left header
U1_Y = TEENSY_LAST_Y + 8.0
U2_X = U1_X
U2_Y = BOARD_H - 25.0

# MPR121 touch ICs (QFN-20, 4×4mm, 0.5mm pitch)
MPR_BODY = 4.0
MPR_PITCH = 0.5
MPR_PAD_W = 0.3
MPR_PAD_H = 0.8
MPR_EPAD = 2.6
MPR_PINS_PER_SIDE = 5

# Slider IC placement: near their respective sliders
MPR_VSLIDER_X = MARGIN + SLIDER_W / 2        # center of vertical slider
MPR_VSLIDER_Y = ORIGIN_Y + 8 * PITCH + 5.0   # below vertical slider, in row 9 area
MPR_HSLIDER_X = ORIGIN_X + 12 * PITCH        # center of horizontal slider area
MPR_HSLIDER_Y = ORIGIN_Y + 8 * PITCH + PITCH / 2 + 5.0  # below horizontal slider

# 0603 passive pads (for decoupling caps and pull-up resistors)
P0603_PAD_W = 0.8
P0603_PAD_H = 0.9
P0603_PAD_DX = 0.8             # half center-to-center


# ── Net numbering ────────────────────────────────────────────────────
# 0      : ""
# 1-16   : COL0..COL15
# 17-24  : ROW0..ROW7
# 25     : VCC
# 26     : GND
# 27     : LED_DIN  (data input to first LED)
# 28-154 : LED_CHAIN_1..LED_CHAIN_127 (DOUT→DIN between consecutive LEDs)
# 155-282: SW_0_0..SW_7_15 (switch pin 2 → diode anode)
# 283    : I2C_SDA
# 284    : I2C_SCL

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
# Row 9 modifier keys (directly wired, no matrix)
NET_KEY_SHIFT = _BASE_EXTRA + 2
NET_KEY_CTRL  = _BASE_EXTRA + 3
NET_KEY_OPT   = _BASE_EXTRA + 4
NET_KEY_CMD   = _BASE_EXTRA + 5
NET_KEY_SPACE = _BASE_EXTRA + 6
# Vertical slider pads (8)
def net_vslider(i): return _BASE_EXTRA + 7 + i   # i = 0..7
# Horizontal slider pads (8)
def net_hslider(i): return _BASE_EXTRA + 15 + i  # i = 0..7
# MPR121 IRQ outputs
NET_MPR_IRQ_V = _BASE_EXTRA + 23   # vertical slider IRQ
NET_MPR_IRQ_H = _BASE_EXTRA + 24   # horizontal slider IRQ
TOTAL_NETS = _BASE_EXTRA + 25


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
    nets.append((NET_KEY_SHIFT, '"KEY_SHIFT"'))
    nets.append((NET_KEY_CTRL, '"KEY_CTRL"'))
    nets.append((NET_KEY_OPT, '"KEY_OPT"'))
    nets.append((NET_KEY_CMD, '"KEY_CMD"'))
    nets.append((NET_KEY_SPACE, '"KEY_SPACE"'))
    for i in range(8):
        nets.append((net_vslider(i), f'"VSLIDER{i}"'))
    for i in range(8):
        nets.append((net_hslider(i), f'"HSLIDER{i}"'))
    nets.append((NET_MPR_IRQ_V, '"MPR_IRQ_V"'))
    nets.append((NET_MPR_IRQ_H, '"MPR_IRQ_H"'))
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
    idx = row * COLS + col + 1
    ref = f"SW{idx}"
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
    silk = "\n".join([
        f'    (fp_line (start {fmt(-half)} {fmt(-half)}) (end {fmt(half)} {fmt(-half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(half)} {fmt(-half)}) (end {fmt(half)} {fmt(half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(half)} {fmt(half)}) (end {fmt(-half)} {fmt(half)}) (layer "F.SilkS") (width 0.12))',
        f'    (fp_line (start {fmt(-half)} {fmt(half)}) (end {fmt(-half)} {fmt(-half)}) (layer "F.SilkS") (width 0.12))',
    ])

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
  )"""


def diode_footprint(row, col):
    cx, cy = cell_center(row, col)
    dx = cx + DIODE_OFFSET[0]
    dy = cy + DIODE_OFFSET[1]
    idx = row * COLS + col + 1
    ref = f"D{idx}"
    sw_net = net_sw(row, col)     # anode: from switch
    row_net = net_row(row)        # cathode: to row

    # SOD-323 pads — vertical orientation
    # Pad 1 = cathode (bottom), Pad 2 = anode (top, toward switch)
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
    (fp_line (start -0.6 {fmt(-DIODE_PAD_DY)}) (end 0.6 {fmt(-DIODE_PAD_DY)}) (layer "F.SilkS") (width 0.1))
    (pad "1" smd rect (at 0 {fmt(DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {row_net} {nn(row_net)}))
    (pad "2" smd rect (at 0 {fmt(-DIODE_PAD_DY)}) (size {fmt(DIODE_PAD_W)} {fmt(DIODE_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {sw_net} {nn(sw_net)}))
  )"""


def led_footprint(row, col):
    cx, cy = cell_center(row, col)
    lx = cx + LED_OFFSET[0]
    ly = cy + LED_OFFSET[1]
    idx = row * COLS + col + 1
    ref = f"LED{idx}"

    din_n = led_din_net(row, col)
    dout_n = led_dout_net(row, col)

    # SK6812MINI-E pinout (top view):
    #   Pin1=VDD (TL)   Pin2=DOUT (TR)
    #   Pin4=DIN (BL)   Pin3=GND  (BR)
    pads = [
        ("1", -LED_PAD_DX, -LED_PAD_DY, NET_VCC,  "VDD"),
        ("2",  LED_PAD_DX, -LED_PAD_DY, dout_n,   "DOUT"),
        ("3",  LED_PAD_DX,  LED_PAD_DY, NET_GND,  "GND"),
        ("4", -LED_PAD_DX,  LED_PAD_DY, din_n,    "DIN"),
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
    """Absolute (x, y) of a MCP23017 QFN-28 pad.

    QFN-28: 7 pins/side, counterclockwise from pin 1 at bottom-left.
    Bottom(1-7), Right(8-14), Top(15-21), Left(22-28).
    Rotation in degrees applied after computing local offset.
    """
    import math
    side = (pin - 1) // QFN_PINS_PER_SIDE
    idx = (pin - 1) % QFN_PINS_PER_SIDE
    linear = (idx - 3) * QFN_PAD_PITCH

    if side == 0:    dx, dy = linear, QFN_PAD_EDGE
    elif side == 1:  dx, dy = QFN_PAD_EDGE, -linear
    elif side == 2:  dx, dy = -linear, -QFN_PAD_EDGE
    else:            dx, dy = -QFN_PAD_EDGE, linear

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
    """Generate a MCP23017 QFN-28 footprint (6×6mm), optionally rotated."""
    import math
    half = 3.0
    pads = []
    for pin in range(1, 29):
        px, py = qfn_pin_pos(cx, cy, pin, rotation)
        nid = pin_nets.get(pin, 0)
        side = (pin - 1) // QFN_PINS_PER_SIDE
        # Base pad orientation, then add chip rotation
        if side in (0, 2):
            pad_angle = rotation
        else:
            pad_angle = rotation + 90
        angle_str = f' {pad_angle}' if pad_angle != 0 else ''
        pads.append(
            f'    (pad "{pin}" smd rect '
            f'(at {fmt(px - cx)} {fmt(py - cy)}{angle_str}) '
            f'(size {fmt(QFN_PAD_W)} {fmt(QFN_PAD_H)}) '
            f'(layers "F.Cu" "F.Paste" "F.Mask") '
            f'(net {nid} {nn(nid)}))')
    # Exposed pad (GND) — rotated with chip
    ep_angle_str = f' {rotation}' if rotation != 0 else ''
    pads.append(
        f'    (pad "EP" smd rect (at 0 0{ep_angle_str}) (size 3.5 3.5) '
        f'(layers "F.Cu" "F.Paste" "F.Mask") '
        f'(net {NET_GND} {nn(NET_GND)}))')

    # Rotated outline
    rad = math.radians(rotation)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    rot_corners = [(x*cos_r - y*sin_r, x*sin_r + y*cos_r) for x, y in corners]
    outline = []
    for i in range(4):
        x1, y1 = rot_corners[i]
        x2, y2 = rot_corners[(i + 1) % 4]
        outline.append(f'    (fp_line (start {fmt(x1)} {fmt(y1)}) (end {fmt(x2)} {fmt(y2)}) (layer "F.Fab") (width 0.1))')

    # Pin 1 marker
    p1x, p1y = -half + 0.5, half - 0.5
    rp1x = p1x*cos_r - p1y*sin_r
    rp1y = p1x*sin_r + p1y*cos_r

    return f"""  (footprint "Arp3:MCP23017_QFN28" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "MCP23017 16-bit I2C I/O expander QFN-28 6x6mm rotated {rotation} deg")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -6) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "MCP23017" (at 0 6) (layer "F.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
{chr(10).join(outline)}
    (fp_circle (center {fmt(rp1x)} {fmt(rp1y)}) (end {fmt(rp1x + 0.2)} {fmt(rp1y)}) (layer "F.SilkS") (width 0.1))
{chr(10).join(pads)}
  )"""


def passive_0603(cx, cy, ref, value, net1, net2):
    """Generate a 0603 passive (cap or resistor) footprint."""
    return f"""  (footprint "Arp3:C_0603" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "{value}")
    (attr smd)
    (fp_text reference "{ref}" (at 0 -1.2) (layer "F.SilkS")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_text value "{value}" (at 0 1.2) (layer "F.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (pad "1" smd rect (at {fmt(-P0603_PAD_DX)} 0) (size {fmt(P0603_PAD_W)} {fmt(P0603_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {net1} {nn(net1)}))
    (pad "2" smd rect (at {fmt(P0603_PAD_DX)} 0) (size {fmt(P0603_PAD_W)} {fmt(P0603_PAD_H)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {net2} {nn(net2)}))
  )"""


def mcp_components():
    """MCP23017 expanders, decoupling caps, pull-ups, and output header."""
    parts = []

    # ── U1: column expander (addr 0x20, top-right) ──
    # GPA0-7 → COL0-7, GPB0-7 → COL8-15
    u1_nets = {}
    u1_nets[21] = net_col(0)                             # GPA0 (top)
    for i in range(1, 8):  u1_nets[21 + i] = net_col(i)  # GPA1-7 (left)
    for i in range(7):     u1_nets[1 + i] = net_col(8 + i) # GPB0-6 (bottom)
    u1_nets[8] = net_col(15)                              # GPB7 (right)
    u1_nets[9] = NET_VCC;  u1_nets[10] = NET_GND
    u1_nets[12] = NET_I2C_SCL;  u1_nets[13] = NET_I2C_SDA
    u1_nets[15] = NET_GND;  u1_nets[16] = NET_GND;  u1_nets[17] = NET_GND
    u1_nets[18] = NET_VCC
    parts.append(qfn28_footprint(U1_X, U1_Y, "U1", u1_nets, QFN_ROTATION))

    # ── U2: row expander (addr 0x21, center-bottom of grid) ──
    # GPA0-7 → ROW0-7, GPB spare
    u2_nets = {}
    u2_nets[21] = net_row(0)                              # GPA0 (top)
    for i in range(1, 8):  u2_nets[21 + i] = net_row(i)  # GPA1-7 (left)
    u2_nets[9] = NET_VCC;  u2_nets[10] = NET_GND
    u2_nets[12] = NET_I2C_SCL;  u2_nets[13] = NET_I2C_SDA
    u2_nets[15] = NET_VCC;  u2_nets[16] = NET_GND;  u2_nets[17] = NET_GND
    u2_nets[18] = NET_VCC
    parts.append(qfn28_footprint(U2_X, U2_Y, "U2", u2_nets, QFN_ROTATION))

    # ── Decoupling caps (near each chip) ──
    parts.append(passive_0603(U1_X + 5, U1_Y, "C1", "100nF", NET_VCC, NET_GND))
    parts.append(passive_0603(U2_X + 5, U2_Y, "C2", "100nF", NET_VCC, NET_GND))

    # ── I2C pull-ups (near Teensy) ──
    parts.append(passive_0603(TEENSY_X, TEENSY_LAST_Y + 3, "R1", "4.7k", NET_I2C_SDA, NET_VCC))
    parts.append(passive_0603(TEENSY_X, TEENSY_LAST_Y + 5, "R2", "4.7k", NET_I2C_SCL, NET_VCC))

    # ── Teensy 4.1 headers (mounted on back, USB at top) ──
    # Left side: GND, 0-12, 3.3V, 24-32
    left_nets = [
        NET_GND,        # GND
        0,              # pin 0 (spare)
        NET_LED_DIN,    # pin 1 → LED data
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  # pins 2-12 (spare)
        NET_VCC,        # 3.3V
        0, 0, 0, 0, 0, 0, 0, 0, 0,         # pins 24-32 (spare)
    ]
    # Right side: Vin, GND, 3.3V, 23-13, 41-33
    right_nets = [
        NET_VCC,        # Vin
        NET_GND,        # GND
        NET_VCC,        # 3.3V
        0, 0, 0, 0,    # pins 23-20 (spare)
        NET_I2C_SCL,    # pin 19 → SCL
        NET_I2C_SDA,    # pin 18 → SDA
        0, 0, 0, 0, 0, # pins 17-13 (spare)
        0, 0, 0, 0, 0, 0, 0, 0, 0,  # pins 41-33 (spare)
    ]

    left_x = TEENSY_X - TEENSY_DX
    right_x = TEENSY_X + TEENSY_DX

    teensy_pads = []
    for i in range(TEENSY_PINS):
        py = i * TEENSY_PITCH
        nid_l = left_nets[i] if i < len(left_nets) else 0
        nid_r = right_nets[i] if i < len(right_nets) else 0
        teensy_pads.append(
            f'    (pad "L{i+1}" thru_hole circle '
            f'(at {fmt(-TEENSY_DX)} {fmt(py)}) '
            f'(size {fmt(TEENSY_PAD_SIZE)} {fmt(TEENSY_PAD_SIZE)}) '
            f'(drill {fmt(TEENSY_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid_l} {nn(nid_l)}))')
        teensy_pads.append(
            f'    (pad "R{i+1}" thru_hole circle '
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

    return "\n".join(parts)


# ── MPR121 touch controller footprints ───────────────────────────────

def mpr121_footprint(cx, cy, ref, pin_nets):
    """MPR121 QFN-20 (4×4mm, 0.5mm pitch, 5 pins/side)."""
    half = MPR_BODY / 2
    pads = []
    for pin in range(1, 21):
        side = (pin - 1) // MPR_PINS_PER_SIDE
        idx = (pin - 1) % MPR_PINS_PER_SIDE
        linear = (idx - 2) * MPR_PITCH

        if side == 0:    dx, dy = -half - MPR_PAD_H / 2, linear      # left
        elif side == 1:  dx, dy = linear, half + MPR_PAD_H / 2       # bottom
        elif side == 2:  dx, dy = half + MPR_PAD_H / 2, -linear      # right
        else:            dx, dy = -linear, -half - MPR_PAD_H / 2     # top

        nid = pin_nets.get(pin, 0)
        if side in (0, 2):
            pw, ph = MPR_PAD_H, MPR_PAD_W
        else:
            pw, ph = MPR_PAD_W, MPR_PAD_H
        pads.append(
            f'    (pad "{pin}" smd rect '
            f'(at {fmt(dx)} {fmt(dy)}) '
            f'(size {fmt(pw)} {fmt(ph)}) '
            f'(layers "F.Cu" "F.Paste" "F.Mask") '
            f'(net {nid} {nn(nid)}))')
    # Exposed pad
    pads.append(
        f'    (pad "EP" smd rect (at 0 0) (size {fmt(MPR_EPAD)} {fmt(MPR_EPAD)}) '
        f'(layers "F.Cu" "F.Paste" "F.Mask") '
        f'(net {NET_GND} {nn(NET_GND)}))')

    return f"""  (footprint "Arp3:MPR121_QFN20" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "MPR121 capacitive touch controller QFN-20 4x4mm")
    (attr smd)
    (fp_text reference "{ref}" (at 0 {fmt(-half - 1.5)}) (layer "F.SilkS")
      (effects (font (size 0.5 0.5) (thickness 0.1)))
    )
    (fp_text value "MPR121" (at 0 {fmt(half + 1.5)}) (layer "F.Fab")
      (effects (font (size 0.4 0.4) (thickness 0.08)))
    )
    (fp_line (start {fmt(-half)} {fmt(-half)}) (end {fmt(half)} {fmt(-half)}) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(half)} {fmt(-half)}) (end {fmt(half)} {fmt(half)}) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(half)} {fmt(half)}) (end {fmt(-half)} {fmt(half)}) (layer "F.Fab") (width 0.1))
    (fp_line (start {fmt(-half)} {fmt(half)}) (end {fmt(-half)} {fmt(-half)}) (layer "F.Fab") (width 0.1))
    (fp_circle (center {fmt(-half + 0.5)} {fmt(-half + 0.5)}) (end {fmt(-half + 0.7)} {fmt(-half + 0.5)}) (layer "F.SilkS") (width 0.1))
{chr(10).join(pads)}
  )"""


def slider_ics():
    """Two MPR121 touch controllers + decoupling caps."""
    parts = []

    # MPR121 pinout (QFN-20, 5 pins/side, counter-clockwise from pin 1):
    # Left(1-5):   VDD, VSS, VREG, SCL, SDA
    # Bottom(6-10): IRQ, nc, REXT, ELE0, ELE1
    # Right(11-15): VSS, ELE2, ELE3, ELE4, ELE5
    # Top(16-20):   ELE6, ELE7, ELE8, ELE9, ELE10/ELE11/ADDR/VDD
    # (exact pinout simplified — nets assigned to electrodes)

    # U3: vertical slider (addr 0x5A, ADDR→GND)
    u3_nets = {
        1: NET_VCC, 2: NET_GND, 3: 0,  # VDD, VSS, VREG
        4: NET_I2C_SCL, 5: NET_I2C_SDA,
        6: NET_MPR_IRQ_V,
        9: net_vslider(0), 10: net_vslider(1),
        11: NET_GND,
        12: net_vslider(2), 13: net_vslider(3),
        14: net_vslider(4), 15: net_vslider(5),
        16: net_vslider(6), 17: net_vslider(7),
        20: NET_VCC,
    }
    parts.append(mpr121_footprint(MPR_VSLIDER_X, MPR_VSLIDER_Y, "U3", u3_nets))

    # U4: horizontal slider (addr 0x5B, ADDR→VDD)
    u4_nets = {
        1: NET_VCC, 2: NET_GND, 3: 0,
        4: NET_I2C_SCL, 5: NET_I2C_SDA,
        6: NET_MPR_IRQ_H,
        9: net_hslider(0), 10: net_hslider(1),
        11: NET_GND,
        12: net_hslider(2), 13: net_hslider(3),
        14: net_hslider(4), 15: net_hslider(5),
        16: net_hslider(6), 17: net_hslider(7),
        20: NET_VCC,
    }
    parts.append(mpr121_footprint(MPR_HSLIDER_X, MPR_HSLIDER_Y, "U4", u4_nets))

    # Decoupling caps (100nF VDD, 100nF VREG per chip)
    parts.append(passive_0603(MPR_VSLIDER_X + 4, MPR_VSLIDER_Y, "C3", "100nF", NET_VCC, NET_GND))
    parts.append(passive_0603(MPR_VSLIDER_X + 4, MPR_VSLIDER_Y + 2, "C4", "100nF", NET_VCC, NET_GND))
    parts.append(passive_0603(MPR_HSLIDER_X + 4, MPR_HSLIDER_Y, "C5", "100nF", NET_VCC, NET_GND))
    parts.append(passive_0603(MPR_HSLIDER_X + 4, MPR_HSLIDER_Y + 2, "C6", "100nF", NET_VCC, NET_GND))

    return "\n".join(parts)


# ── Row 9: modifier keys + space bar ────────────────────────────────

ROW9_KEYS = [
    ("SW_SHIFT", NET_KEY_SHIFT, 0),    # col 0
    ("SW_CTRL",  NET_KEY_CTRL,  1),    # col 1
    ("SW_OPT",   NET_KEY_OPT,   2),    # col 2
    ("SW_CMD",   NET_KEY_CMD,   3),    # col 3
]

def row9_switches():
    """Modifier keys (1u each) and space bar (2u) on row 9. No LEDs."""
    parts = []
    row = ROWS  # row index 8

    for ref, net, col in ROW9_KEYS:
        cx, cy = cell_center(row, col)
        parts.append(f"""  (footprint "Arp3:Kailh_Choc_V1" (layer "F.Cu")
    (at {fmt(cx)} {fmt(cy)})
    (descr "Kailh Choc V1 modifier key")
    (attr through_hole)
    (fp_text reference "{ref}" (at 0 -8.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (pad "1" thru_hole circle (at {fmt(SW_PAD1[0])} {fmt(SW_PAD1[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {net} {nn(net)}))
    (pad "2" thru_hole circle (at {fmt(SW_PAD2[0])} {fmt(SW_PAD2[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {NET_GND} {nn(NET_GND)}))
    (pad "" np_thru_hole circle (at 0 0) (size {fmt(SW_CENTER_DRILL)} {fmt(SW_CENTER_DRILL)}) (drill {fmt(SW_CENTER_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[0][0])} {fmt(SW_SIDE_POSTS[0][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[1][0])} {fmt(SW_SIDE_POSTS[1][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
  )""")

    # Space bar — 4u wide, centered between cols 4-7
    space_cx = ORIGIN_X + 5.5 * PITCH
    space_cy = ORIGIN_Y + row * PITCH
    parts.append(f"""  (footprint "Arp3:Kailh_Choc_V1" (layer "F.Cu")
    (at {fmt(space_cx)} {fmt(space_cy)})
    (descr "Kailh Choc V1 space bar 2u")
    (attr through_hole)
    (fp_text reference "SW_SPACE" (at 0 -8.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (pad "1" thru_hole circle (at {fmt(SW_PAD1[0])} {fmt(SW_PAD1[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {NET_KEY_SPACE} {nn(NET_KEY_SPACE)}))
    (pad "2" thru_hole circle (at {fmt(SW_PAD2[0])} {fmt(SW_PAD2[1])}) (size {fmt(SW_PAD_SIZE)} {fmt(SW_PAD_SIZE)}) (drill {fmt(SW_PAD_DRILL)}) (layers "*.Cu" "*.Mask") (net {NET_GND} {nn(NET_GND)}))
    (pad "" np_thru_hole circle (at 0 0) (size {fmt(SW_CENTER_DRILL)} {fmt(SW_CENTER_DRILL)}) (drill {fmt(SW_CENTER_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[0][0])} {fmt(SW_SIDE_POSTS[0][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at {fmt(SW_SIDE_POSTS[1][0])} {fmt(SW_SIDE_POSTS[1][1])}) (size {fmt(SW_SIDE_DRILL)} {fmt(SW_SIDE_DRILL)}) (drill {fmt(SW_SIDE_DRILL)}) (layers "*.Cu" "*.Mask"))
  )""")

    return "\n".join(parts)


# ── Capacitive sliders ──────────────────────────────────────────────

SLIDER_PAD_GAP = 0.3      # gap between adjacent slider pads
SLIDER_TOOTH_AMP = 2.5    # zigzag amplitude
SLIDER_TOOTH_H = 2.5      # height of one zigzag tooth


def zigzag_boundary(x_center, y_bot, y_top, amp, half_gap):
    """Vertical zigzag boundary for a vertical slider."""
    pts = []
    n_teeth = int((y_top - y_bot) / SLIDER_TOOTH_H)
    th = (y_top - y_bot) / max(n_teeth, 1)
    for i in range(n_teeth):
        y0 = y_bot + i * th
        y1 = y0 + th / 2.0
        pts.append((x_center - amp + half_gap, y0))
        pts.append((x_center + amp + half_gap, y1))
    pts.append((x_center - amp + half_gap, y_top))
    return pts


def hzigzag_boundary(y_center, x_left, x_right, amp, half_gap):
    """Horizontal zigzag boundary for a horizontal slider."""
    pts = []
    n_teeth = int((x_right - x_left) / SLIDER_TOOTH_H)
    tw = (x_right - x_left) / max(n_teeth, 1)
    for i in range(n_teeth):
        x0 = x_left + i * tw
        x1 = x0 + tw / 2.0
        pts.append((x0, y_center - amp + half_gap))
        pts.append((x1, y_center + amp + half_gap))
    pts.append((x_right, y_center - amp + half_gap))
    return pts


def _vzig(y_center, x_left, x_right, n_teeth, amp, half_gap):
    """Horizontal zigzag boundary at a given Y (for vertical slider).
    Returns points from left to right."""
    pts = []
    tw = (x_right - x_left) / max(n_teeth, 1)
    for i in range(n_teeth):
        x0 = x_left + i * tw
        x1 = x0 + tw / 2.0
        pts.append((x0, y_center - amp + half_gap))
        pts.append((x1, y_center + amp + half_gap))
    pts.append((x_right, y_center - amp + half_gap))
    return pts


def _hzig(x_center, y_top, y_bot, n_teeth, amp, half_gap):
    """Vertical zigzag boundary at a given X (for horizontal slider).
    Returns points from top to bottom."""
    pts = []
    th = (y_bot - y_top) / max(n_teeth, 1)
    for i in range(n_teeth):
        y0 = y_top + i * th
        y1 = y0 + th / 2.0
        pts.append((x_center - amp + half_gap, y0))
        pts.append((x_center + amp + half_gap, y1))
    pts.append((x_center - amp + half_gap, y_bot))
    return pts


def vertical_slider_zones():
    """8 chevron copper zones for the vertical slider, left of grid."""
    zones = []
    hg = SLIDER_PAD_GAP / 2
    sl_x0 = MARGIN
    sl_x1 = MARGIN + SLIDER_W
    n_teeth = int(SLIDER_W / SLIDER_TOOTH_H)

    for i in range(8):
        net_id = net_vslider(i)
        net_name = nn(net_id)
        pad_y0 = ORIGIN_Y - PITCH / 2 + i * PITCH
        pad_y1 = pad_y0 + PITCH
        bnd_y0 = pad_y0
        bnd_y1 = pad_y1

        pts = []
        # Top edge: straight if first pad, zigzag otherwise
        if i == 0:
            pts.append((sl_x0, bnd_y0))
            pts.append((sl_x1, bnd_y0))
        else:
            pts.extend(_vzig(bnd_y0, sl_x0, sl_x1, n_teeth, SLIDER_TOOTH_AMP, +hg))

        # Bottom edge (right to left): straight if last pad, zigzag reversed
        if i == 7:
            pts.append((sl_x1, bnd_y1))
            pts.append((sl_x0, bnd_y1))
        else:
            bottom = _vzig(bnd_y1, sl_x0, sl_x1, n_teeth, SLIDER_TOOTH_AMP, -hg)
            bottom.reverse()
            pts.extend(bottom)

        xy_str = " ".join(f"(xy {fmt(x)} {fmt(y)})" for x, y in pts)
        zones.append(f"""  (zone (net {net_id}) (net_name {net_name}) (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {xy_str}))
  )""")
    return "\n".join(zones)


def horizontal_slider_zones():
    """8 chevron copper zones for the horizontal slider, right half of row 9."""
    zones = []
    hg = SLIDER_PAD_GAP / 2
    sl_y_center = ORIGIN_Y + ROWS * PITCH
    sl_y0 = sl_y_center - PITCH / 2
    sl_y1 = sl_y_center + PITCH / 2
    n_teeth = int(PITCH / SLIDER_TOOTH_H)

    for i in range(8):
        net_id = net_hslider(i)
        net_name = nn(net_id)
        pad_x0 = ORIGIN_X + (8 + i) * PITCH - PITCH / 2
        pad_x1 = pad_x0 + PITCH

        pts = []
        # Left edge (top to bottom): straight if first, zigzag otherwise
        if i == 0:
            pts.append((pad_x0, sl_y0))
            pts.append((pad_x0, sl_y1))
        else:
            pts.extend(_hzig(pad_x0, sl_y0, sl_y1, n_teeth, SLIDER_TOOTH_AMP, +hg))

        # Right edge (bottom to top): straight if last, zigzag reversed
        if i == 7:
            pts.append((pad_x1, sl_y1))
            pts.append((pad_x1, sl_y0))
        else:
            right = _hzig(pad_x1, sl_y0, sl_y1, n_teeth, SLIDER_TOOTH_AMP, -hg)
            right.reverse()
            pts.extend(right)

        xy_str = " ".join(f"(xy {fmt(x)} {fmt(y)})" for x, y in pts)
        zones.append(f"""  (zone (net {net_id}) (net_name {net_name}) (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {xy_str}))
  )""")
    return "\n".join(zones)


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
    return f"""  (zone (net {NET_GND}) (net_name "GND") (layer "B.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts
      (xy 0 0) (xy {fmt(BOARD_W)} 0)
      (xy {fmt(BOARD_W)} {fmt(BOARD_H)}) (xy 0 {fmt(BOARD_H)})
    ))
  )"""


def vcc_zone():
    """VCC fill on F.Cu, covering the right-side connector area."""
    grid_right = ORIGIN_X + (COLS - 1) * PITCH + PITCH / 2 + 2
    return f"""  (zone (net {NET_VCC}) (net_name "VCC") (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts
      (xy {fmt(grid_right)} 0) (xy {fmt(BOARD_W)} 0)
      (xy {fmt(BOARD_W)} {fmt(BOARD_H)}) (xy {fmt(grid_right)} {fmt(BOARD_H)})
    ))
  )"""


# ── Routing primitives ────────────────────────────────────────────────

TRACE_W = 0.25   # signal trace width (mm)
POWER_W = 0.5    # power trace width (mm)
VIA_SIZE = 0.8
VIA_DRILL = 0.4

# Column trace vertical trunk offset from switch center x.
# Must clear center post (radius 1.5 mm) and LED pads (edge at cx ± 1.55).
COL_TRUNK_DX = -2.5

# LED data horizontal routing channel (y offset from switch center)
LED_DATA_BUS_DY = -2.0

# LED VCC horizontal bus (y offset from switch center), clear of DOUT vias at -3.3
LED_VCC_BUS_DY = -4.5

# Inter-row LED chain routing margin (x offset from switch center)
LED_INTERROW_MARGIN = 8.0


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
    for r in range(ROWS):
        for c in range(COLS):
            cx, cy = cell_center(r, c)
            n = net_sw(r, c)
            # SW pad 2: (cx + 5.0, cy + 3.8)
            # Diode anode (pad 2): (cx + 5.0, cy + 7.0 - 0.95) = (cx + 5.0, cy + 6.05)
            lines.append(seg(cx + 5.0, cy + 3.8, cx + 5.0, cy + 6.05,
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

        for r in range(ROWS):
            cy = ORIGIN_Y + r * PITCH
            pad_y = cy + SW_PAD1[1]  # cy + 5.9

            # Horizontal stub: pad → trunk
            lines.append(seg(cx, pad_y, trunk_x, pad_y, TRACE_W, "F.Cu", n))

            # Vertical trunk to next row
            if r < ROWS - 1:
                next_pad_y = ORIGIN_Y + (r + 1) * PITCH + SW_PAD1[1]
                lines.append(seg(trunk_x, pad_y, trunk_x, next_pad_y,
                                 TRACE_W, "F.Cu", n))
    return "\n".join(lines)


def route_rows():
    """B.Cu: horizontal row bus connecting diode cathodes via vias.

    Via at each diode cathode pad (F.Cu SMD) drops to B.Cu.  Horizontal trace
    on B.Cu links all cathodes in the same row.
    """
    lines = []
    for r in range(ROWS):
        n = net_row(r)
        cy = ORIGIN_Y + r * PITCH
        via_y = cy + DIODE_OFFSET[1] + DIODE_PAD_DY  # cy + 7.95

        for c in range(COLS):
            cx = ORIGIN_X + c * PITCH
            via_x = cx + DIODE_OFFSET[0]  # cx + 5.0

            # Via from F.Cu diode cathode pad to B.Cu
            lines.append(via_hole(via_x, via_y, n))

            # Horizontal B.Cu trace to next column's diode
            if c < COLS - 1:
                next_x = ORIGIN_X + (c + 1) * PITCH + DIODE_OFFSET[0]
                lines.append(seg(via_x, via_y, next_x, via_y,
                                 TRACE_W, "B.Cu", n))
    return "\n".join(lines)


def route_led_chain():
    """B.Cu: snaking LED data chain with vias at DOUT / DIN pads.

    Intra-row connections route through a horizontal channel at
    cy + LED_DATA_BUS_DY.  Inter-row connections route through the board
    margin (left or right of the grid).
    """
    lines = []

    # Via at first LED's DIN pad (LED_DIN input)
    cx0, cy0 = cell_center(0, 0)
    lines.append(via_hole(cx0 + LED_OFFSET[0] - LED_PAD_DX,
                          cy0 + LED_OFFSET[1] + LED_PAD_DY,
                          NET_LED_DIN))

    total = ROWS * COLS
    for n in range(total - 1):
        src_r, src_c = chain_to_rc(n)
        dst_r, dst_c = chain_to_rc(n + 1)
        src_cx, src_cy = cell_center(src_r, src_c)
        dst_cx, dst_cy = cell_center(dst_r, dst_c)

        # DOUT pad absolute position (LED offset + pad offset)
        dout_x = src_cx + LED_OFFSET[0] + LED_PAD_DX   # cx + 1.2
        dout_y = src_cy + LED_OFFSET[1] - LED_PAD_DY   # cy - 3.3
        # DIN pad absolute position
        din_x = dst_cx + LED_OFFSET[0] - LED_PAD_DX    # cx - 1.2
        din_y = dst_cy + LED_OFFSET[1] + LED_PAD_DY    # cy - 1.7

        chain_n = net_led_chain(n + 1)

        # Vias at DOUT and DIN
        lines.append(via_hole(dout_x, dout_y, chain_n))
        lines.append(via_hole(din_x, din_y, chain_n))

        if src_r == dst_r:
            # ── Intra-row: horizontal channel on B.Cu ──
            bus_y = src_cy + LED_DATA_BUS_DY  # cy - 2.0
            lines += chamfer_route([
                (dout_x, dout_y),
                (dout_x, bus_y),
                (din_x, bus_y),
                (din_x, din_y),
            ], TRACE_W, "B.Cu", chain_n)
        else:
            # ── Inter-row: route between rows ──
            if src_c == COLS - 1:
                # Right-side transition (even→odd row) — route through
                # switch pad gap on F.Cu (between center post and pad 2)
                route_x = src_cx + 2.7
                led_cy = dst_cy + LED_OFFSET[1]  # destination LED center Y
                lines += chamfer_route([
                    (dout_x, dout_y),
                    (route_x, dout_y),      # jog right into switch gap
                    (route_x, led_cy),       # down between pads 1 and 2
                    (din_x, led_cy),         # left through LED pad gap
                    (din_x, din_y),          # down to DIN pad
                ], TRACE_W, "F.Cu", chain_n, chamfer=0.15)
            else:
                # Left-side transition (odd→even row) — B.Cu margin
                margin_x = src_cx - LED_INTERROW_MARGIN
                lines += chamfer_route([
                    (dout_x, dout_y),
                    (margin_x, dout_y),
                    (margin_x, din_y),
                    (din_x, din_y),
                ], TRACE_W, "B.Cu", chain_n)
    return "\n".join(lines)


def route_led_gnd():
    """Via at each LED GND pad → B.Cu ground fill."""
    lines = []
    for r in range(ROWS):
        for c in range(COLS):
            cx, cy = cell_center(r, c)
            gnd_x = cx + LED_OFFSET[0] + LED_PAD_DX   # cx + 1.2
            gnd_y = cy + LED_OFFSET[1] + LED_PAD_DY   # cy - 1.7
            lines.append(via_hole(gnd_x, gnd_y, NET_GND))
    return "\n".join(lines)


def route_led_vcc():
    """B.Cu: VCC bus per row with vias at each LED VCC pad.

    Bus runs at cy + LED_VCC_BUS_DY (below the DOUT vias at cy - 3.3).
    Short stubs connect each VCC pad via to the bus.
    """
    lines = []
    for r in range(ROWS):
        cy = ORIGIN_Y + r * PITCH
        pad_y = cy + LED_OFFSET[1] - LED_PAD_DY  # cy - 3.3
        bus_y = cy + LED_VCC_BUS_DY               # cy - 4.5

        for c in range(COLS):
            cx = ORIGIN_X + c * PITCH
            vcc_x = cx + LED_OFFSET[0] - LED_PAD_DX  # cx - 1.2

            # Via at VCC pad
            lines.append(via_hole(vcc_x, pad_y, NET_VCC))
            # Stub from via to bus
            lines.append(seg(vcc_x, pad_y, vcc_x, bus_y,
                             POWER_W, "B.Cu", NET_VCC))
            # Horizontal bus to next column
            if c < COLS - 1:
                next_x = ORIGIN_X + (c + 1) * PITCH + LED_OFFSET[0] - LED_PAD_DX
                lines.append(seg(vcc_x, bus_y, next_x, bus_y,
                                 POWER_W, "B.Cu", NET_VCC))
    return "\n".join(lines)


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
    """Route column trunks to U1 (column expander) on the right.

    4 columns per gap, leftmost columns first (top gap).
    COL 0-3 between rows 3-4, COL 4-7 between rows 4-5, etc.
    All within the grid (no traces below bottom row).

    B.Cu horizontal through gap, via to F.Cu, then fan-in upward to U1.

    Fan-in X ordering: COL 0 is leftmost (outermost), COL 15 is
    rightmost (closest to MCP pins — goes nearly straight up).
    Within each group, the top trace (lowest within-index) gets the
    leftmost X so it turns upward first without crossing.
    """
    lines = []
    via_x_right = ORIGIN_X + (COLS - 1) * PITCH + DIODE_OFFSET[0] + 1.0
    fanin_start = via_x_right + 1.5   # leftmost fan-in (COL 0)

    for c in range(COLS):
        n = net_col(c)
        cx = ORIGIN_X + c * PITCH
        trunk_x = cx + COL_TRUNK_DX
        target_x, target_y = col_pin_pos(c)

        # Leftmost cols first: COL 0-3 in gap rows 3-4, COL 4-7 in 4-5, etc.
        group = c // COLS_PER_GAP
        within = c % COLS_PER_GAP
        n_in_group = min(COLS_PER_GAP, COLS - group * COLS_PER_GAP)
        gap_row = 3 + group  # rows 3-4, 4-5, 5-6, 6-7

        gap_center = ORIGIN_Y + gap_row * PITCH + 11.25
        gap_y = gap_center + (within - (n_in_group - 1) / 2.0) * GAP_Y_SPACING

        # Fan-in X: COL 0 leftmost (outermost), COL 15 rightmost (innermost).
        # At the horizontal→vertical corner (turning left/up), leftmost
        # trace turns first — COL0 is leftmost, turns first.
        fanin_x = fanin_start + c * CONN_FANIN_SPACING

        # Via from F.Cu trunk to B.Cu
        lines.append(via_hole(trunk_x, gap_y, n))
        # B.Cu horizontal through gap
        lines.append(seg(trunk_x, gap_y, via_x_right, gap_y,
                         TRACE_W, "B.Cu", n))
        # Via back to F.Cu
        lines.append(via_hole(via_x_right, gap_y, n))

        # F.Cu route depends on which QFN side the pin is on:
        #
        # COL0-7 (top/left pins): approach pad from the RIGHT.
        #   Run up to pin Y, then horizontal right to the pad.
        #   Spread: COL0 (outermost) turns right first (highest Y).
        #
        # COL8-15 (bottom/right pins): approach pad from BELOW.
        #   Run up, then diagonal right to land under the pad,
        #   then straight up into the pad.
        #   Spread: COL8 (outermost) turns right first (highest Y).

        # Via from F.Cu trunk to B.Cu
        lines.append(via_hole(trunk_x, gap_y, n))
        # B.Cu horizontal through gap to right edge of grid
        lines.append(seg(trunk_x, gap_y, via_x_right, gap_y,
                         TRACE_W, "B.Cu", n))
        # Via back to F.Cu — manual routing from here to QFN pins
        lines.append(via_hole(via_x_right, gap_y, n))
    return "\n".join(lines)


def route_conn_power():
    """VCC and GND connector pins are connected via zone fills (B.Cu GND
    zone and F.Cu VCC zone).  No explicit traces needed."""
    return ""

    return "\n".join(lines)


def route_conn_led_din():
    """LED_DIN via exists at first LED. Manual routing to Teensy."""
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
    routing_conn_power = route_conn_power()
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

{slider_ics()}

{vertical_slider_zones()}

{horizontal_slider_zones()}

{routing_sw_diode}

{routing_cols}

{routing_rows}

{routing_led_chain}

{routing_led_gnd}

{routing_led_vcc}

{routing_conn_rows}

{routing_conn_cols}

{routing_conn_power}

{routing_conn_led_din}

{ground_zone()}

{vcc_zone()}

)
"""


if __name__ == "__main__":
    sys.stdout.write(generate())
