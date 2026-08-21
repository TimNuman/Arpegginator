import { css } from "@emotion/react";
import { bevelIn, bevelOut, cavityIn, caption, chrome } from "../../theme/chrome";

export const gridOuterContainerStyles = css`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
`;

export const gridInnerContainerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

/** The keybed: a cavity milled into the case, keycaps sitting proud of it. */
export const gridContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  background: ${chrome.cavity};
  ${cavityIn}
`;

export const verticalStripContainerStyles = css`
  display: flex;
  align-items: center;
  padding: 20px 0;
`;

export const horizontalStripContainerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
`;

export const modifierKeysContainerStyles = css`
  display: flex;
  gap: 4px;
`;

/** Hold-keys: milky plastic, raised, and they physically go down when held. */
export const modifierKeyStyles = css`
  width: 64px;
  height: 32px;
  overflow: hidden;
  border-radius: 2px;
  background: linear-gradient(180deg, ${chrome.capTop}, ${chrome.capBottom});
  ${bevelOut}
  ${caption}
  font-size: 9px;
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
    width: 78px;
    height: 44px;
    font-size: 12px;
  }
`;

export const modifierKeyFnStyles = css`
  font-size: 6.5px;
  font-weight: 400;
  letter-spacing: 0.2px;
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
  padding: 20px 0;
`;

export const oledColumnStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** The panel, set into the case behind its own dark bezel. No inner glow —
    a reflective LCD is lit by the room, not from behind. */
export const oledScreenStyles = css`
  width: 400px;
  height: 240px;
  background: #cfd6cb;
  border: 8px solid ${chrome.cavityDeep};
  border-radius: 3px;
  box-shadow:
    0 0 0 1px ${chrome.caseShadow},
    0 0 0 2px ${chrome.caseLight},
    inset 0 0 0 1px rgba(0, 0, 0, 0.5);
  overflow: hidden;
`;

export const encoderRowStyles = css`
  display: flex;
  gap: 16px;
  margin-top: 12px;
  align-items: flex-start;
`;

export const arrowButtonContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 12px;
  gap: 2px;
`;

export const arrowButtonRowStyles = css`
  display: flex;
  gap: 2px;
`;

export const arrowButtonStyles = css`
  width: 32px;
  height: 32px;
  border-radius: 2px;
  background: linear-gradient(180deg, ${chrome.capTop}, ${chrome.capBottom});
  ${bevelOut}
  color: ${chrome.ink};
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;

  &:hover {
    background: linear-gradient(180deg, #fffdf5, ${chrome.capMid});
  }

  &:active {
    background: linear-gradient(180deg, ${chrome.capBottom}, ${chrome.capMid});
    ${bevelIn}
    padding: 2px 0 0 2px;
  }
`;
