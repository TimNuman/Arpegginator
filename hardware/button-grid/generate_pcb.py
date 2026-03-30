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

MARGIN = 7.5
BOARD_W = COLS * PITCH + 2 * MARGIN          # ~319.8 mm
BOARD_H = ROWS * PITCH + 2 * MARGIN + 12.0   # +12 for connector area

# Origin of cell (0,0) — top-left switch center
ORIGIN_X = MARGIN + PITCH / 2
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

# ── Connectors ────────────────────────────────────────────────────────
CONN_Y = BOARD_H - 6.0       # near bottom edge
CONN_PAD_DRILL = 1.0
CONN_PAD_SIZE = 1.7
CONN_PITCH_MM = 2.54


# ── Net numbering ────────────────────────────────────────────────────
# 0      : ""
# 1-16   : COL0..COL15
# 17-24  : ROW0..ROW7
# 25     : VCC
# 26     : GND
# 27     : LED_DIN  (data input to first LED)
# 28-154 : LED_CHAIN_1..LED_CHAIN_127 (DOUT→DIN between consecutive LEDs)
# 155-282: SW_0_0..SW_7_15 (switch pin 2 → diode anode)

def net_col(c):        return 1 + c
def net_row(r):        return 17 + r
NET_VCC = 25
NET_GND = 26
NET_LED_DIN = 27
def net_led_chain(n):  return 28 + n - 1   # n = 1..127
def net_sw(r, c):      return 155 + r * COLS + c
TOTAL_NETS = 155 + ROWS * COLS  # 283


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


def connectors():
    """Two pin headers at the bottom: J1 for columns + power, J2 for rows."""
    parts = []

    # J1: 20-pin header — COL0..COL15 + VCC + GND + LED_DIN + spare
    j1_nets = [net_col(c) for c in range(COLS)] + [NET_VCC, NET_GND, NET_LED_DIN, 0]
    j1_x_start = ORIGIN_X
    j1_pads = []
    for i, nid in enumerate(j1_nets):
        px = i * CONN_PITCH_MM
        j1_pads.append(
            f'    (pad "{i+1}" thru_hole circle '
            f'(at {fmt(px)} 0) '
            f'(size {fmt(CONN_PAD_SIZE)} {fmt(CONN_PAD_SIZE)}) '
            f'(drill {fmt(CONN_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid} {nn(nid)}))')

    parts.append(f"""  (footprint "Arp3:PinHeader_1x20_P2.54mm" (layer "F.Cu")
    (at {fmt(j1_x_start)} {fmt(CONN_Y)})
    (descr "COL0-15, VCC, GND, LED_DIN, spare")
    (attr through_hole)
    (fp_text reference "J1" (at {fmt(9 * CONN_PITCH_MM)} -2.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text value "COL+PWR" (at {fmt(9 * CONN_PITCH_MM)} 2.5) (layer "F.Fab")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
{chr(10).join(j1_pads)}
  )""")

    # J2: 8-pin header — ROW0..ROW7
    j2_x_start = ORIGIN_X + 22 * CONN_PITCH_MM  # offset from J1
    j2_pads = []
    for i in range(ROWS):
        nid = net_row(i)
        px = i * CONN_PITCH_MM
        j2_pads.append(
            f'    (pad "{i+1}" thru_hole circle '
            f'(at {fmt(px)} 0) '
            f'(size {fmt(CONN_PAD_SIZE)} {fmt(CONN_PAD_SIZE)}) '
            f'(drill {fmt(CONN_PAD_DRILL)}) '
            f'(layers "*.Cu" "*.Mask") '
            f'(net {nid} {nn(nid)}))')

    parts.append(f"""  (footprint "Arp3:PinHeader_1x08_P2.54mm" (layer "F.Cu")
    (at {fmt(j2_x_start)} {fmt(CONN_Y)})
    (descr "ROW0-7")
    (attr through_hole)
    (fp_text reference "J2" (at {fmt(3.5 * CONN_PITCH_MM)} -2.5) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.12)))
    )
    (fp_text value "ROWS" (at {fmt(3.5 * CONN_PITCH_MM)} 2.5) (layer "F.Fab")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
{chr(10).join(j2_pads)}
  )""")

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
    """VCC fill on F.Cu, limited to the connector area below the grid."""
    grid_bottom = ORIGIN_Y + (ROWS - 1) * PITCH + PITCH / 2 + 2
    return f"""  (zone (net {NET_VCC}) (net_name "VCC") (layer "F.Cu") (tstamp {uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts
      (xy 0 {fmt(grid_bottom)}) (xy {fmt(BOARD_W)} {fmt(grid_bottom)})
      (xy {fmt(BOARD_W)} {fmt(BOARD_H)}) (xy 0 {fmt(BOARD_H)})
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
            lines.append(seg(dout_x, dout_y, dout_x, bus_y,
                             TRACE_W, "B.Cu", chain_n))
            lines.append(seg(dout_x, bus_y, din_x, bus_y,
                             TRACE_W, "B.Cu", chain_n))
            lines.append(seg(din_x, bus_y, din_x, din_y,
                             TRACE_W, "B.Cu", chain_n))
        else:
            # ── Inter-row: route through board margin ──
            if src_c == COLS - 1:
                # Right-side transition (even→odd row)
                margin_x = src_cx + LED_INTERROW_MARGIN
            else:
                # Left-side transition (odd→even row)
                margin_x = src_cx - LED_INTERROW_MARGIN
            lines.append(seg(dout_x, dout_y, margin_x, dout_y,
                             TRACE_W, "B.Cu", chain_n))
            lines.append(seg(margin_x, dout_y, margin_x, din_y,
                             TRACE_W, "B.Cu", chain_n))
            lines.append(seg(margin_x, din_y, din_x, din_y,
                             TRACE_W, "B.Cu", chain_n))
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

    return f"""(kicad_pcb (version 20221018) (generator "arp3_grid_gen")

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

{connectors()}

{routing_sw_diode}

{routing_cols}

{routing_rows}

{routing_led_chain}

{routing_led_gnd}

{routing_led_vcc}

{ground_zone()}

{vcc_zone()}

)
"""


if __name__ == "__main__":
    sys.stdout.write(generate())
