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

  ; ── Nets ({len(nets)} total) ──
{net_defs}

  ; ══════ Board outline ({fmt(BOARD_W)} × {fmt(BOARD_H)} mm) ══════
{board_outline()}

  ; ══════ Kailh Choc V1 switches (128) ══════
{all_switches}

  ; ══════ Anti-ghosting diodes (128) ══════
{all_diodes}

  ; ══════ SK6812MINI-E RGBW LEDs (128) ══════
{all_leds}

  ; ══════ Connectors ══════
{connectors()}

  ; ══════ Ground fill (B.Cu) ══════
{ground_zone()}

  ; ══════ VCC fill (F.Cu, connector area only) ══════
{vcc_zone()}

)
"""


if __name__ == "__main__":
    sys.stdout.write(generate())
