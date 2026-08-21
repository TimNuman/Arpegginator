import { css } from "@emotion/react";
import { bevelIn, bevelOut, cavityIn, caption, chrome, moulded } from "../../theme/chrome";
import { dims, panelLegendCenter, px } from "../../theme/dimensions";

export const gridOuterContainerStyles = css`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  /* The slider cell butts against the grid cells on the board, so the only
     space between them is the gap two caps would leave. */
  gap: ${dims.pitch - dims.capW}px;
`;

export const gridInnerContainerStyles = css`
  display: flex;
  flex-direction: column;
  /* Row 9 on the board — modifier keys, space, horizontal slider */
  gap: ${dims.pitchY - dims.capH}px;
`;

/** The keywell: a tray moulded into the top shell, its floor a darker shot of
    plastic, with the caps standing proud of it. */
export const gridContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  /* The floor stays as dark as it always was: the pads are semi-transparent,
     and the engine draws octave lines, beat markers and the playhead as low
     alpha over it, so lifting this washes that structure out. */
  background-color: #101010;
  background-image: ${moulded}, linear-gradient(160deg, #1c1c1c 0%, #141414 55%, #0d0d0d 100%);
  ${cavityIn}
  border-radius: 6px;
`;

/* Cap geometry: 44px pitch, 40px cap, so the first cap starts 12px inside the
   well (1px border + 9px padding + 2px margin) and the block runs 4px short of
   the pitch. Every strip and key below is placed off those two numbers. */
export const verticalStripContainerStyles = css`
  display: flex;
  align-items: flex-start;
  margin-top: ${dims.capMarginY + 1}px;
`;

export const horizontalStripContainerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 ${dims.capMarginX + 1}px;
`;

export const modifierKeysContainerStyles = css`
  display: flex;
  gap: ${dims.pitch - dims.capW}px;
`;

/** Hold-keys: milky plastic, raised, and they physically go down when held.
    Sized in cap widths so they line up with the columns above them. */
export const modifierKeyStyles = (width: number) => css`
  width: ${width}px;
  height: ${dims.capH}px;
  overflow: hidden;
  border-radius: 2px;
  background: linear-gradient(180deg, ${chrome.capTop}, ${chrome.capBottom});
  ${bevelOut}
  ${caption}
  font-size: ${px(2.6)}px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: all 0.1s ease;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;

  /* Short screens (landscape phone): the whole UI is scaled down, so give
     these hold-keys a larger natural size to stay finger-friendly */
  @media (max-height: 520px) {
    width: ${Math.round(width * 1.7)}px;
    height: 44px;
    font-size: 12px;
  }
`;

export const modifierKeyFnStyles = css`
  font-size: ${px(1.7)}px;
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  color: ${chrome.inkDim};

  @media (max-height: 520px) {
    font-size: 9px;
  }
`;

export const modifierKeyActiveStyles = css`
  background: linear-gradient(180deg, ${chrome.capBottom}, ${chrome.capMid});
  ${bevelIn}
  padding-top: 2px;
`;

/* Double-tapped sticky latch: the little panel LED comes on and stays on */
export const modifierKeyLatchedStyles = css`
  color: ${chrome.led};
  text-shadow: 0 0 4px rgba(200, 64, 47, 0.45);
`;

export const oledContainerStyles = css`
  display: flex;
  align-items: flex-start;
  /* Runs the full height of the keybed so the column's last row can settle on
     the same bottom line as the modifier keys across the case. */
  align-self: stretch;
  /* DISP_X on the board: the module sits 3 mm right of the grid */
  margin-left: ${dims.displayGap - (dims.pitch - dims.capW)}px;
`;

export const oledColumnStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
`;

/** The panel, dropped into a recess in the top shell behind a moulded bezel.
    No inner glow — a reflective LCD is lit by the room, not from behind. */
export const oledScreenStyles = css`
  /* Border-box sizing means the bezel eats the content box, so the panel is
     stated at 240x320 plus its bezel on each side. Anything less and the
     canvas resamples a 1-bit image to a fractional scale. */
  width: ${240 + 2 * dims.bezelX}px;
  height: ${320 + 2 * dims.bezelY}px;
  background: #cfd6cb;
  /* Two-value widths need the longhand — the border shorthand takes one */
  border-width: ${dims.bezelY}px ${dims.bezelX}px;
  border-style: solid;
  border-color: ${chrome.cavityDeep};
  border-radius: 5px;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(0, 0, 0, 0.4),
    0 0 0 2px ${chrome.caseLight},
    0 3px 6px rgba(0, 0, 0, 0.35);
  overflow: hidden;
`;

/** The panel packs its legend 1 + 2, so the two encoder axes are the pair on
    the bottom row — slab centres at 60 and 176 in panel pixels. Each knob sits
    under the slab it drives, measured from the display's outer edge. */
export const encoderRowStyles = css`
  display: flex;
  align-self: flex-start;
  /* Each knob centred under the panel button it drives, measured from the
     display's outer edge: bezel + the button's centre in panel pixels. */
  margin-left: ${dims.bezelX + panelLegendCenter(1) - dims.encoder / 2}px;
  gap: ${panelLegendCenter(2) - panelLegendCenter(1) - dims.encoder}px;
  margin-top: ${px(4)}px;
  align-items: flex-start;
`;

/** Transport keys sit on the case below the knobs, spaced like the grid and
    centred on the pair above them. */
const keyRowWidth = 3 * dims.capW + 2 * (dims.pitch - dims.capW);
const knobGroupCenter = dims.bezelX + (panelLegendCenter(1) + panelLegendCenter(2)) / 2;

export const transportKeysContainerStyles = css`
  display: flex;
  align-self: flex-start;
  gap: ${dims.pitch - dims.capW}px;
  /* Pushed to the foot of the column: the portrait module is tall enough that
     this row lands level with the modifier keys on the other side of the case,
     which is the one horizontal line the whole instrument can share. */
  margin-top: auto;
  margin-left: ${knobGroupCenter - keyRowWidth / 2}px;
`;
