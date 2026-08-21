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

  /** JDI LPM044M141A — 4.4" colour memory LCD, 320 x 240 */
  displayModuleW: 92.664,
  displayModuleH: 72.748,
  /** Active area: 320 x 240 at a 0.2802 mm pixel pitch */
  displayActiveW: 89.664,
  displayActiveH: 67.248,
  /** The module sits 3 mm to the right of the grid */
  displayGap: 3.0,

  /** A panel-mount rotary encoder that clears its neighbour under the
      panel's buttons */
  encoder: 16.0,
} as const;

/**
 * The scale is anchored on the panel: 320 device pixels across 89.664 mm of
 * active area, so the 1-bit UI lands 1:1 and its hairlines stay hairlines.
 * At 0.28 mm per pixel the panel is coarse enough that the whole instrument
 * comes to about 1450 px — it fits a normal window at 1:1, which the 2.7"
 * part never managed. Lower this to shrink the device further; the
 * proportions hold either way.
 */
export const PX_PER_MM = 320 / mm.displayActiveW;

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
} as const;

/**
 * Where the panel draws its three modifier buttons, in panel pixels — these
 * mirror BTN_MARGIN / BTN_W / BTN_GAP in engine/src/oled_screen.rs. The knobs
 * on the case line up with them, so the two have to agree.
 */
export const panelButton = { margin: 6, width: 96, gap: 8 } as const;
export const panelButtonCenter = (i: number) =>
  panelButton.margin + i * (panelButton.width + panelButton.gap) + panelButton.width / 2;
