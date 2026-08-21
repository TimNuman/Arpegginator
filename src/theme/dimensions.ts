/**
 * dimensions.ts — the device at true scale.
 *
 * Every measurement here is the real hardware in millimetres, taken from
 * hardware/generate_pcb.py where the board defines it and from the part
 * datasheets otherwise. The UI derives its pixels from these, so the web
 * version is the instrument at 1:1 rather than a diagram of it.
 */

export const mm = {
  /** hardware/generate_pcb.py PITCH — standard 1U keyboard spacing */
  pitch: 19.05,
  /** Kailh Choc v1 (PG1350) keycap — not square, and shorter than it is wide */
  capW: 17.5,
  capH: 16.5,

  cols: 16,
  rows: 8,

  /** SLIDER_W — the touch strips are exactly one button wide */
  sliderW: 19.05,

  /** DISP_MOD_W / DISP_MOD_H — the module outline the board allots */
  displayModuleW: 63.0,
  displayModuleH: 43.0,
  /** LPM027M128C active area: 400 x 240 at a 0.1476 mm pixel pitch */
  displayActiveW: 59.04,
  displayActiveH: 35.42,
  /** DISP_X — the module sits 3 mm to the right of the grid */
  displayGap: 3.0,

  /** A panel-mount rotary encoder small enough to sit under the panel's
      buttons, which are only 19.2 mm apart on a 2.7" screen */
  encoder: 16.0,
} as const;

/**
 * The scale is anchored on the panel: 400 device pixels across 59.04 mm of
 * active area, so the 1-bit UI lands 1:1 and its hairlines stay hairlines.
 * Everything else follows from that, which makes the machine large — a real
 * 128-key instrument is nearly 400 mm across — so the stage's fit-scale takes
 * over on smaller viewports. Lower this to trade panel sharpness for a
 * smaller device; the proportions hold either way.
 */
export const PX_PER_MM = 400 / mm.displayActiveW;

/** Millimetres to CSS pixels. */
export const px = (v: number) => v * PX_PER_MM;

export const dims = {
  pitch: px(mm.pitch),
  capW: px(mm.capW),
  capH: px(mm.capH),
  /** Half the gap between caps — the margin each cap carries in its cell */
  capMarginX: px((mm.pitch - mm.capW) / 2),
  capMarginY: px((mm.pitch - mm.capH) / 2),

  gridW: px(mm.cols * mm.pitch),
  gridH: px(mm.rows * mm.pitch),
  /** First cap's edge to the last cap's edge, which is what things align to */
  capsW: px((mm.cols - 1) * mm.pitch + mm.capW),
  capsH: px((mm.rows - 1) * mm.pitch + mm.capH),

  sliderThickness: px(mm.capW),
  /** A strip spanning eight buttons, edge to edge like the caps */
  slider8: px(7 * mm.pitch + mm.capW),
  slider8V: px(7 * mm.pitch + mm.capH),

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
export const panelButton = { margin: 8, width: 120, gap: 10 } as const;
export const panelButtonCenter = (i: number) =>
  panelButton.margin + i * (panelButton.width + panelButton.gap) + panelButton.width / 2;
