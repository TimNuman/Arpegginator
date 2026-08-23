/**
 * dimensions.ts — the device at true scale.
 *
 * Every measurement here is the real hardware in millimetres, taken from
 * hardware/generate_pcb.py where the board defines it and from the part
 * datasheets otherwise. The UI derives its pixels from these, so the web
 * version is the instrument at 1:1 rather than a diagram of it.
 */

export const mm = {
  /** Kailh Choc native spacing — 18 x 17 mm, not the MX 1U the board started
      on. Caps are 17.5 x 16.5 mm, so this leaves 0.5 mm between them: tight,
      but it is the spacing the switch was designed around. */
  pitchX: 18,
  pitchY: 17,
  capW: 17.5,
  capH: 16.5,

  cols: 16,
  rows: 8,

  /** The touch strips are one button wide */
  sliderW: 18,

  /** JDI LPM044M141A — 4.4" reflective colour memory LCD, mounted on its side.
      Rotating it takes ~20 mm off the case width, because the module is the
      widest thing in the right-hand column. */
  displayModuleW: 72.748,
  displayModuleH: 92.664,
  /** Active area. The glass is 640x480 at a 0.1401 mm pitch; the UI is drawn
      at 240x320 and lands as 2x2 blocks, which is what makes a 5x8 label
      2.2 mm tall instead of 1.1 mm. So a UI pixel is 0.2802 mm. */
  displayActiveW: 67.248,
  displayActiveH: 89.664,
  /** The module sits 3 mm to the right of the grid */
  displayGap: 3.0,

  /**
   * Kailh Choc v1 (PG1350) seen from above, for rendering a transparent cap.
   * The housing is 15 mm square under a cap that overhangs it; the keycap
   * mounts on two rails 5.7 mm apart rather than a cross stem; and the
   * SK6812MINI-E sits in the switch's north LED window, 4.70 mm above centre
   * — LED_OFFSET in hardware/generate_pcb.py. That offset is why a clear cap
   * lights brightest along its top edge instead of in the middle.
   */
  switchBody: 15.0,
  switchCorner: 0.6,
  stemSpacing: 5.7,
  stemW: 1.2,
  stemH: 3.0,
  ledOffsetY: -4.7,
  ledW: 3.5,
  ledH: 3.0,
  /** Cap wall thickness — the part that pipes light out to the edges */
  capWall: 1.0,

  /** The dot on the white caps: a milky disc about a fifth of the cap across,
      set into the top face over the LED hole rather than at the cap's centre
      — so it lands on ledOffsetY, slightly above the middle. */
  dot: 4.0,

  /** Knob for a panel-mount encoder (6 mm shaft). The panel's buttons are
      29.1 mm apart on the 4.4", so a standard 20 mm knob clears its
      neighbour with room to spare. */
  encoder: 20.0,
} as const;

/**
 * The scale is anchored on the panel: 320 device pixels across 89.664 mm of
 * active area, so the 1-bit UI lands 1:1 and its hairlines stay hairlines.
 * At 0.28 mm per pixel the panel is coarse enough that the whole instrument
 * comes to about 1450 px — it fits a normal window at 1:1, which the 2.7"
 * part never managed. Lower this to shrink the device further; the
 * proportions hold either way.
 */
export const PX_PER_MM = 240 / mm.displayActiveW;

/** Millimetres to CSS pixels. */
export const px = (v: number) => v * PX_PER_MM;

export const dims = {
  pitch: px(mm.pitchX),
  pitchY: px(mm.pitchY),
  capW: px(mm.capW),
  capH: px(mm.capH),
  /** Half the gap between caps — the margin each cap carries in its cell */
  capMarginX: px((mm.pitchX - mm.capW) / 2),
  capMarginY: px((mm.pitchY - mm.capH) / 2),

  gridW: px(mm.cols * mm.pitchX),
  gridH: px(mm.rows * mm.pitchY),
  /** First cap's edge to the last cap's edge, which is what things align to */
  capsW: px((mm.cols - 1) * mm.pitchX + mm.capW),
  capsH: px((mm.rows - 1) * mm.pitchY + mm.capH),

  sliderThickness: px(mm.capW),
  /** A strip spanning eight buttons, edge to edge like the caps */
  slider8: px(7 * mm.pitchX + mm.capW),
  slider8V: px(7 * mm.pitchY + mm.capH),

  displayGap: px(mm.displayGap),
  /** Bezel is the module outline minus the active area, split either side */
  bezelX: px((mm.displayModuleW - mm.displayActiveW) / 2),
  bezelY: px((mm.displayModuleH - mm.displayActiveH) / 2),

  encoder: px(mm.encoder),

  switchBody: px(mm.switchBody),
  switchCorner: px(mm.switchCorner),
  stemSpacing: px(mm.stemSpacing),
  stemW: px(mm.stemW),
  stemH: px(mm.stemH),
  ledOffsetY: px(mm.ledOffsetY),
  ledW: px(mm.ledW),
  ledH: px(mm.ledH),
  capWall: px(mm.capWall),
  dot: px(mm.dot),
} as const;

/**
 * Where the panel draws its three modifier slabs, in panel pixels — these
 * mirror legend_box() in engine/src/oled_screen.rs. The knobs on the case line
 * up with the two on the bottom row, so the two have to agree.
 *
 * Packed 1 + 2: the grid axis takes the full width on top, the two encoder
 * axes share the row beneath, which is the shape of the two knobs below.
 */
const PANEL_W = 240;
export const panelLegend = {
  margin: 6,
  gap: 8,
  shadow: 3,
  full: PANEL_W - 2 * 6 - 3,
  // Integer division, to land on the same pixel the engine does
  half: Math.floor((PANEL_W - 2 * 6 - 8 - 3) / 2),
} as const;

/** Centre of legend slab `col` in panel pixels. */
export const panelLegendCenter = (col: number) =>
  col === 0
    ? panelLegend.margin + panelLegend.full / 2
    : col === 1
      ? panelLegend.margin + panelLegend.half / 2
      : panelLegend.margin + panelLegend.half + panelLegend.gap + panelLegend.half / 2;
