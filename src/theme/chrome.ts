/**
 * chrome.ts — the case the simulated hardware sits in.
 *
 * The display is a reflective 1-bit panel dressed in System 6 window chrome,
 * so the web shell around it is the machine that panel would have been bolted
 * into: a beige desktop box from about 1992. Platinum plastic, hard two-step
 * bevels, milky keycaps lit from underneath, and a teal desktop behind it all.
 * Every surface is one of these tokens — no ad-hoc greys.
 */

export const chrome = {
  /** Win 3.1's teal desktop, pulled a little green so beige reads warm on it */
  desktop: "#0d7c77",
  desktopDark: "#065c58",

  /** Platinum case plastic, and the four tones its bevels are cut from */
  case: "#d9d5c9",
  caseLight: "#fffefa",
  caseHi: "#eae7dd",
  caseMid: "#c3bfb2",
  caseShadow: "#8d8a7f",
  caseDark: "#42403a",

  /** Keycap plastic: milky, warm, lit from beneath by the LED under it */
  capTop: "#f6f3ea",
  capMid: "#e8e4d7",
  capBottom: "#d8d3c2",

  /** Recessed cavities — the grid well, the display bezel */
  cavity: "#2e2c28",
  cavityDeep: "#1b1a17",

  ink: "#2b2a26",
  inkDim: "#6f6c63",
  /** Panel-indicator red, the little LED next to a floppy slot */
  led: "#c8402f",
  ledDim: "#6d3229",

  font: '"MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif',
} as const;

/** Raised plastic: light from the top-left, shadow to the bottom-right. */
export const bevelOut = `
  border: 1px solid ${chrome.caseDark};
  box-shadow:
    inset 1px 1px 0 ${chrome.caseLight},
    inset -1px -1px 0 ${chrome.caseShadow},
    inset 2px 2px 0 ${chrome.caseHi},
    inset -2px -2px 0 ${chrome.caseMid};
`;

/** The same bevel inverted — pressed buttons and sunken wells. */
export const bevelIn = `
  border: 1px solid ${chrome.caseShadow};
  box-shadow:
    inset 1px 1px 0 ${chrome.caseShadow},
    inset -1px -1px 0 ${chrome.caseLight},
    inset 2px 2px 0 ${chrome.caseMid},
    inset -2px -2px 0 ${chrome.caseHi};
`;

/** A deep cavity for things set into the case: the grid, the display. */
export const cavityIn = `
  border: 1px solid ${chrome.caseShadow};
  box-shadow:
    inset 2px 2px 4px rgba(0, 0, 0, 0.55),
    inset -1px -1px 0 ${chrome.caseLight},
    0 1px 0 ${chrome.caseLight};
`;

/** Title-bar pinstripes, same gesture the display draws in its own chrome. */
export const pinstripes = `
  background-image: repeating-linear-gradient(
    180deg,
    ${chrome.caseDark} 0px,
    ${chrome.caseDark} 1px,
    ${chrome.case} 1px,
    ${chrome.case} 3px
  );
`;

/** Uppercase system-UI label, the way every 16-bit dialog set its captions. */
export const caption = `
  font-family: ${chrome.font};
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${chrome.ink};
`;
