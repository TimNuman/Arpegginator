import { px } from "./dimensions";

/**
 * chrome.ts — the enclosure the simulated hardware is moulded into.
 *
 * Not a window and not an application: the page is a physical object on a
 * desk, in the spirit of a 90s keyboard. Injection-moulded ABS that has gone
 * slightly warm with age, a keywell milled into the top shell, doubleshot
 * caps with a dished top face, screen-printed legends, and pinpoint status
 * LEDs. Every surface comes from these tokens — no ad-hoc greys.
 */

export const chrome = {
  /** The desk it sits on */
  desk: "#3a3a38",
  deskDark: "#1e1e20",

  /** Moulded ABS: lit top edge, body, and the shaded lower shell */
  caseTop: "#efeadd",
  case: "#e4dece",
  caseLow: "#d2ccb9",
  caseLight: "#fffdf4",
  caseHi: "#eae4d5",
  caseMid: "#cac4b1",
  caseShadow: "#9b9686",
  caseDark: "#55514a",

  /** Doubleshot cap: skirt, dished top face, and the shade under the lip */
  capSkirt: "#ded8c7",
  capTop: "#f8f5ec",
  capMid: "#ece8db",
  capBottom: "#d9d3c1",

  /** The keywell floor and the display bezel, moulded in a darker shot */
  cavity: "#33322e",
  cavityDeep: "#1b1a17",

  /** Kailh Choc v1 White: black nylon bottom housing under a clear top, with
      a white stem in the middle of the cap. It is the one bright part you see
      through a transparent cap, and being white it takes on whatever colour
      the LED 4.7 mm north of it is driving. */
  stem: "#eceae3",
  stemLow: "#b8b6ae",

  /** White PBT Choc keycap: cooler and flatter than the case's ivory ABS,
      and matte where the case is faintly glossy. */
  keycapTop: "#f4f3ef",
  keycapMid: "#e4e3dd",
  keycapLow: "#c6c5be",

  ink: "#2b2a26",
  /** Screen-printed legends: pad-printed grey, never pure black */
  inkDim: "#7d786c",
  /** Pinpoint status LEDs behind their little window */
  led: "#d63b26",
  ledDim: "#5c2a22",
  ledGreen: "#3f9c4a",

  font: '"MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif',

  /**
   * How the reflective panel renders each of its eight colors. The display
   * blit maps the engine's RGB565 through exactly these, so anything on the
   * case that has to agree with what is on screen — the encoder caps, which
   * carry the same axis colors as the buttons along the bottom of the panel —
   * reads them from here rather than eyeballing a match.
   */
  panel: {
    ink: "#34383a",
    paper: "#cfd6cb",
    red: "#a8443f",
    green: "#749868",
    blue: "#4a5a94",
    yellow: "#c4be6e",
    magenta: "#9a608e",
    cyan: "#7eb1b2",
  },
} as const;

/** A moulded key or button: rounded, lit along the top lip, shaded beneath. */
export const bevelOut = `
  border: 1px solid rgba(85, 81, 74, 0.42);
  border-radius: 4px;
  box-shadow:
    inset 0 1px 0 ${chrome.caseLight},
    inset 0 -3px 4px -2px rgba(0, 0, 0, 0.22),
    0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 3px rgba(0, 0, 0, 0.32);
`;

/** The same key pressed: it sinks, its lip loses the light, the shade closes. */
export const bevelIn = `
  border: 1px solid rgba(85, 81, 74, 0.55);
  border-radius: 4px;
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.32),
    inset 0 -1px 0 rgba(255, 255, 255, 0.35);
`;

/** A well milled into the top shell — the keybed, the display recess. */
export const cavityIn = `
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 4px;
  box-shadow:
    inset 0 3px 6px rgba(0, 0, 0, 0.6),
    inset 0 -1px 0 rgba(255, 255, 255, 0.18),
    0 1px 0 ${chrome.caseLight};
`;

/** Fine moulding texture — ABS is never optically flat. This is a bare
    gradient, not a declaration: compose it into a background-image list ahead
    of the surface's own gradient, or it would replace it. */
export const moulded = `repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.05) 0px,
    rgba(255, 255, 255, 0.05) 1px,
    rgba(0, 0, 0, 0.022) 1px,
    rgba(0, 0, 0, 0.022) 2px
  )`;

/** Pad-printed legend: small, tracked out, never pure black. Sized in
    millimetres like everything else on the case — roughly 2.2 mm of cap
    height, which is what a silkscreened legend actually measures. */
export const caption = `
  font-family: ${chrome.font};
  font-size: ${px(2.2)}px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${chrome.inkDim};
`;
