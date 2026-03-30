#!/usr/bin/env python3
"""Generate a KiCad 7 PCB file for the AT42QT2120 chevron capacitive slider.

Run:  python3 generate_pcb.py > slider.kicad_pcb
"""

# ── Geometry parameters (mm) ──────────────────────────────────────────
BOARD_W = 128.0          # total board width (x)
BOARD_H = 18.0           # total board height (y)
CORNER_R = 1.0           # board corner radius (approximated with segments)

SLIDER_X0 = 5.0          # slider left edge
SLIDER_X1 = 105.0        # slider right edge (100 mm active)
SLIDER_Y0 = 4.0          # slider bottom edge
SLIDER_Y1 = 14.0         # slider top edge (10 mm wide)

NUM_KEYS = 8
KEY_PITCH = (SLIDER_X1 - SLIDER_X0) / NUM_KEYS  # 12.5 mm

TOOTH_AMP = 2.5          # zigzag amplitude (± from boundary center)
TOOTH_H = 2.5            # height of one zigzag tooth
NUM_TEETH = int((SLIDER_Y1 - SLIDER_Y0) / TOOTH_H)  # 4
GAP = 0.3                # gap between adjacent electrodes
HALF_GAP = GAP / 2.0

# IC placement (AT42QT2120-MMH QFN-24, 4×4 mm, 0.5 mm pitch)
IC_X = 116.0             # center of IC
IC_Y = 9.0
QFN_BODY = 4.0
QFN_PITCH = 0.5
QFN_PAD_W = 0.3          # pad width (along pin row)
QFN_PAD_L = 0.8          # pad length (perpendicular)
QFN_EPAD = 2.6           # exposed pad size

# Connector (J1: 5-pin 2.54 mm header for VCC, GND, SDA, SCL, CHANGE#)
CONN_X0 = 109.0
CONN_Y = 9.0
CONN_PITCH = 2.54
CONN_PINS = 5

# Passives placement
CAP1_X, CAP1_Y = 112.0, 3.5    # 100nF decoupling
CAP2_X, CAP2_Y = 112.0, 14.5   # 10uF bulk
R1_X, R1_Y = 108.0, 3.5        # SDA pull-up
R2_X, R2_Y = 108.0, 14.5       # SCL pull-up


# ── Nets ──────────────────────────────────────────────────────────────
NETS = ['""', '"KEY0"', '"KEY1"', '"KEY2"', '"KEY3"',
        '"KEY4"', '"KEY5"', '"KEY6"', '"KEY7"',
        '"GND"', '"VCC"', '"SDA"', '"SCL"', '"CHANGE"']


def zigzag_boundary(x_center, y_bot, y_top, n_teeth, amp, x_offset=0.0):
    """Return list of (x, y) points tracing a zigzag from bottom to top.

    At y_bot the zigzag starts at x_center - amp (left),
    at y_bot + tooth_h/2 it reaches x_center + amp (right), etc.
    x_offset shifts all x values (used for gap).
    """
    pts = []
    th = (y_top - y_bot) / n_teeth
    for i in range(n_teeth):
        y0 = y_bot + i * th
        y1 = y0 + th / 2.0
        pts.append((x_center - amp + x_offset, y0))
        pts.append((x_center + amp + x_offset, y1))
    pts.append((x_center - amp + x_offset, y_top))
    return pts


def electrode_polygon(key_idx):
    """Return list of (x, y) vertices for the given key electrode."""
    pts = []

    # ── Left edge (bottom → top) ──
    if key_idx == 0:
        pts.append((SLIDER_X0, SLIDER_Y0))
        pts.append((SLIDER_X0, SLIDER_Y1))
    else:
        x_bnd = SLIDER_X0 + key_idx * KEY_PITCH
        pts.extend(zigzag_boundary(x_bnd, SLIDER_Y0, SLIDER_Y1,
                                   NUM_TEETH, TOOTH_AMP, +HALF_GAP))

    # ── Right edge (top → bottom) ──
    if key_idx == NUM_KEYS - 1:
        pts.append((SLIDER_X1, SLIDER_Y1))
        pts.append((SLIDER_X1, SLIDER_Y0))
    else:
        x_bnd = SLIDER_X0 + (key_idx + 1) * KEY_PITCH
        right_pts = zigzag_boundary(x_bnd, SLIDER_Y0, SLIDER_Y1,
                                    NUM_TEETH, TOOTH_AMP, -HALF_GAP)
        right_pts.reverse()
        pts.extend(right_pts)

    return pts


def fmt(v):
    """Format a float to 4 decimal places, stripping trailing zeros."""
    return f"{v:.4f}".rstrip('0').rstrip('.')


def board_outline():
    """Edge.Cuts rectangle with rounded corners (line segments)."""
    lines = []
    # Simple rectangle — KiCad will display it fine
    corners = [(0, 0), (BOARD_W, 0), (BOARD_W, BOARD_H), (0, BOARD_H)]
    for i in range(4):
        x1, y1 = corners[i]
        x2, y2 = corners[(i + 1) % 4]
        lines.append(f'  (gr_line (start {fmt(x1)} {fmt(y1)}) '
                     f'(end {fmt(x2)} {fmt(y2)}) '
                     f'(layer "Edge.Cuts") (width 0.1))')
    return "\n".join(lines)


def electrode_zone(key_idx):
    """KiCad zone for one slider electrode."""
    net_id = key_idx + 1
    net_name = NETS[net_id]
    pts = electrode_polygon(key_idx)
    xy_str = " ".join(f"(xy {fmt(x)} {fmt(y)})" for x, y in pts)
    return f"""  (zone (net {net_id}) (net_name {net_name}) (layer "F.Cu") (tstamp {_uuid()})
    (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.2)
    (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts {xy_str}))
    (filled_polygon (layer "F.Cu") (pts {xy_str}))
  )"""


_uuid_counter = 0
def _uuid():
    """Generate a simple unique ID for KiCad tstamp fields."""
    global _uuid_counter
    _uuid_counter += 1
    return f"00000000-0000-0000-0000-{_uuid_counter:012d}"


def qfn24_footprint():
    """AT42QT2120-MMH QFN-24 (4×4 mm) footprint at (IC_X, IC_Y).

    Pin 1 is top-left. Pins go counter-clockwise.
    Side 1 (left):   pins 1-6   (x = IC_X - 2.1, varying y)
    Side 2 (bottom):  pins 7-12  (varying x, y = IC_Y + 2.1)
    Side 3 (right):  pins 13-18 (x = IC_X + 2.1, varying y, bottom to top)
    Side 4 (top):    pins 19-24 (varying x, y = IC_Y - 2.1, right to left)
    """
    pads = []
    # Pad positions: 6 pins per side, centered, 0.5mm pitch
    # Side starts offset: -(6-1)/2 * pitch = -1.25mm from center

    # Net assignments (approximate — user should verify against datasheet)
    # Pin 1: MODE (GND for I2C)
    # Pin 3: SDA, Pin 4: VSS, Pin 5: SCL, Pin 6: CHANGE#
    # Pins 7-14: KEY0-KEY7
    # Pin 16: VDD, others: reserved/VSS
    pin_nets = {
        1: 9,    # MODE → GND
        2: 0,    # RST
        3: 11,   # SDA
        4: 9,    # VSS
        5: 12,   # SCL
        6: 13,   # CHANGE#
        7: 1,    # KEY0
        8: 2,    # KEY1
        9: 3,    # KEY2
        10: 4,   # KEY3
        11: 5,   # KEY4
        12: 6,   # KEY5
        13: 7,   # KEY6
        14: 8,   # KEY7
        15: 0,   # KEY8 (unused)
        16: 10,  # VDD
        17: 0,   # KEY9 (unused)
        18: 9,   # VSS
        19: 0,   # KEY10 (unused)
        20: 0,   # KEY11 (unused)
        21: 0,   # reserved
        22: 0,   # reserved
        23: 0,   # reserved
        24: 0,   # reserved
    }

    def make_pad(pin, x, y, w, h):
        net = pin_nets.get(pin, 0)
        net_name = NETS[net]
        return (f'    (pad "{pin}" smd rect (at {fmt(x)} {fmt(y)}) '
                f'(size {fmt(w)} {fmt(h)}) '
                f'(layers "F.Cu" "F.Paste" "F.Mask") '
                f'(net {net} {net_name}))')

    # Left side: pins 1-6 (x negative, y top to bottom)
    for i in range(6):
        px = IC_X - QFN_BODY / 2 - QFN_PAD_L / 2 + QFN_BODY / 2
        px = IC_X - (QFN_BODY / 2)
        py = IC_Y - 1.25 + i * QFN_PITCH
        pads.append(make_pad(i + 1, px - QFN_PAD_L / 2, py, QFN_PAD_L, QFN_PAD_W))

    # Bottom side: pins 7-12 (y positive, x left to right)
    for i in range(6):
        px = IC_X - 1.25 + i * QFN_PITCH
        py = IC_Y + (QFN_BODY / 2)
        pads.append(make_pad(i + 7, px, py + QFN_PAD_L / 2, QFN_PAD_W, QFN_PAD_L))

    # Right side: pins 13-18 (x positive, y bottom to top)
    for i in range(6):
        px = IC_X + (QFN_BODY / 2)
        py = IC_Y + 1.25 - i * QFN_PITCH
        pads.append(make_pad(i + 13, px + QFN_PAD_L / 2, py, QFN_PAD_L, QFN_PAD_W))

    # Top side: pins 19-24 (y negative, x right to left)
    for i in range(6):
        px = IC_X + 1.25 - i * QFN_PITCH
        py = IC_Y - (QFN_BODY / 2)
        pads.append(make_pad(i + 19, px, py - QFN_PAD_L / 2, QFN_PAD_W, QFN_PAD_L))

    # Exposed pad
    pads.append(f'    (pad "25" smd rect (at {fmt(IC_X)} {fmt(IC_Y)}) '
                f'(size {fmt(QFN_EPAD)} {fmt(QFN_EPAD)}) '
                f'(layers "F.Cu" "F.Paste" "F.Mask") '
                f'(net 9 "GND"))')

    pad_str = "\n".join(pads)
    body_half = QFN_BODY / 2

    return f"""  (footprint "Arp3:AT42QT2120-MMH" (layer "F.Cu")
    (at {fmt(IC_X)} {fmt(IC_Y)})
    (attr smd)
    (fp_text reference "U1" (at 0 {fmt(-body_half - 1.5)}) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.15)))
    )
    (fp_text value "AT42QT2120" (at 0 {fmt(body_half + 1.5)}) (layer "F.Fab")
      (effects (font (size 0.8 0.8) (thickness 0.15)))
    )
    (fp_line (start {fmt(IC_X - body_half)} {fmt(IC_Y - body_half)}) (end {fmt(IC_X + body_half)} {fmt(IC_Y - body_half)}) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(IC_X + body_half)} {fmt(IC_Y - body_half)}) (end {fmt(IC_X + body_half)} {fmt(IC_Y + body_half)}) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(IC_X + body_half)} {fmt(IC_Y + body_half)}) (end {fmt(IC_X - body_half)} {fmt(IC_Y + body_half)}) (layer "F.SilkS") (width 0.12))
    (fp_line (start {fmt(IC_X - body_half)} {fmt(IC_Y + body_half)}) (end {fmt(IC_X - body_half)} {fmt(IC_Y - body_half)}) (layer "F.SilkS") (width 0.12))
    (fp_circle (center {fmt(IC_X - body_half + 0.5)} {fmt(IC_Y - body_half + 0.5)}) (end {fmt(IC_X - body_half + 0.7)} {fmt(IC_Y - body_half + 0.5)}) (layer "F.SilkS") (width 0.12))
{pad_str}
  )"""


def passive_footprint(ref, value, x, y, net1, net2, rotation=0):
    """0603 passive (cap or resistor) footprint."""
    n1_name = NETS[net1]
    n2_name = NETS[net2]
    pad_cx = 0.75  # distance from center to pad center
    pw, ph = 0.9, 0.8  # pad size
    if rotation == 90:
        dx1, dy1 = 0, -pad_cx
        dx2, dy2 = 0, pad_cx
        pw, ph = ph, pw
    else:
        dx1, dy1 = -pad_cx, 0
        dx2, dy2 = pad_cx, 0
    return f"""  (footprint "Arp3:C_0603" (layer "F.Cu")
    (at {fmt(x)} {fmt(y)})
    (attr smd)
    (fp_text reference "{ref}" (at 0 -1.2) (layer "F.SilkS")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (fp_text value "{value}" (at 0 1.2) (layer "F.Fab")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
    (pad "1" smd rect (at {fmt(x + dx1)} {fmt(y + dy1)}) (size {fmt(pw)} {fmt(ph)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {net1} {n1_name}))
    (pad "2" smd rect (at {fmt(x + dx2)} {fmt(y + dy2)}) (size {fmt(pw)} {fmt(ph)}) (layers "F.Cu" "F.Paste" "F.Mask") (net {net2} {n2_name}))
  )"""


def connector_footprint():
    """5-pin 2.54mm through-hole header."""
    pads = []
    pin_nets = [10, 9, 11, 12, 13]  # VCC, GND, SDA, SCL, CHANGE#
    pin_labels = ["VCC", "GND", "SDA", "SCL", "CHG"]
    for i in range(CONN_PINS):
        px = CONN_X0
        py = CONN_Y - (CONN_PINS - 1) / 2 * CONN_PITCH + i * CONN_PITCH
        net = pin_nets[i]
        net_name = NETS[net]
        pads.append(f'    (pad "{i+1}" thru_hole circle (at {fmt(px)} {fmt(py)}) '
                    f'(size 1.7 1.7) (drill 1.0) '
                    f'(layers "*.Cu" "*.Mask") '
                    f'(net {net} {net_name}))')
    pad_str = "\n".join(pads)
    return f"""  (footprint "Arp3:PinHeader_1x05_P2.54mm" (layer "F.Cu")
    (at {fmt(CONN_X0)} {fmt(CONN_Y)})
    (attr through_hole)
    (fp_text reference "J1" (at -2 0) (layer "F.SilkS")
      (effects (font (size 0.8 0.8) (thickness 0.15)))
    )
    (fp_text value "CONN" (at 2 0) (layer "F.Fab")
      (effects (font (size 0.6 0.6) (thickness 0.1)))
    )
{pad_str}
  )"""


def ground_zone():
    """Ground fill on B.Cu, with keepout under slider electrodes."""
    # Full board ground zone on back copper
    return f"""  (zone (net 9) (net_name "GND") (layer "B.Cu") (tstamp {_uuid()})
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


def keepout_zone():
    """Keepout under slider area — no copper on B.Cu directly beneath electrodes."""
    margin = 1.0
    x0 = SLIDER_X0 - margin
    x1 = SLIDER_X1 + margin
    y0 = SLIDER_Y0 - margin
    y1 = SLIDER_Y1 + margin
    return f"""  (rule_area "slider_keepout" (id {_uuid()}) (hatch edge 0.5) (connect_pads (clearance 0)) (min_thickness 0.25) (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))
    (layer "B.Cu")
    (polygon (pts
      (xy {fmt(x0)} {fmt(y0)}) (xy {fmt(x1)} {fmt(y0)})
      (xy {fmt(x1)} {fmt(y1)}) (xy {fmt(x0)} {fmt(y1)})
    ))
  )"""


def slider_silkscreen():
    """Silkscreen outline around the slider area."""
    m = 0.5
    x0, y0 = SLIDER_X0 - m, SLIDER_Y0 - m
    x1, y1 = SLIDER_X1 + m, SLIDER_Y1 + m
    lines = []
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for i in range(4):
        ax, ay = corners[i]
        bx, by = corners[(i + 1) % 4]
        lines.append(f'  (gr_line (start {fmt(ax)} {fmt(ay)}) '
                     f'(end {fmt(bx)} {fmt(by)}) '
                     f'(layer "F.SilkS") (width 0.15))')
    return "\n".join(lines)


def generate():
    net_defs = "\n".join(f'  (net {i} {NETS[i]})' for i in range(len(NETS)))
    electrode_zones = "\n".join(electrode_zone(i) for i in range(NUM_KEYS))
    passives = "\n".join([
        passive_footprint("C1", "100nF", CAP1_X, CAP1_Y, 10, 9),
        passive_footprint("C2", "10uF", CAP2_X, CAP2_Y, 10, 9),
        passive_footprint("R1", "4.7k", R1_X, R1_Y, 10, 11),
        passive_footprint("R2", "4.7k", R2_X, R2_Y, 10, 12),
    ])

    return f"""(kicad_pcb (version 20240108) (generator "arp3_slider_gen")

  (general
    (thickness 1.6)
  )

  (paper "A4")

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

{slider_silkscreen()}

{electrode_zones}

{ground_zone()}

{keepout_zone()}

{qfn24_footprint()}

{passives}

{connector_footprint()}

)
"""


if __name__ == "__main__":
    print(generate())
