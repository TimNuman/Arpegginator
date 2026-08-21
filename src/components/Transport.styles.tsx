import { css } from "@emotion/react";
import { bevelIn, bevelOut, caption, chrome, moulded } from "../theme/chrome";
import { px } from "../theme/dimensions";

/** Control strip along the top of the enclosure: a shallow recess in the
    shell with the transport keys standing in it. */
export const transportStyles = css`
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: ${px(4)}px;
  padding: ${px(2)}px ${px(3)}px;
  margin-bottom: ${px(2.5)}px;
  border-radius: 6px;
  background-color: ${chrome.case};
  background-image:
    ${moulded},
    linear-gradient(180deg, ${chrome.caseLow} 0%, ${chrome.caseHi} 22%, ${chrome.case} 100%);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.24),
    inset 0 -1px 0 ${chrome.caseLight},
    0 1px 0 ${chrome.caseLight};
`;

export const controlGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

/** Scrollbar-shaped tempo control: sunken trough, square raised thumb. */
export const bpmSliderStyles = css`
  width: ${px(34)}px;
  padding: 0;
  height: ${px(3.6)}px;
  color: ${chrome.case};

  .MuiSlider-rail,
  .MuiSlider-track {
    border-radius: 0;
    opacity: 1;
    height: ${px(3.6)}px;
    background-color: ${chrome.caseMid};
    ${bevelIn}
  }

  .MuiSlider-track {
    background-color: ${chrome.caseHi};
    border-color: transparent;
    box-shadow: none;
  }

  .MuiSlider-thumb {
    width: ${px(3)}px;
    height: ${px(4.6)}px;
    border-radius: 1px;
    background: linear-gradient(180deg, ${chrome.capTop}, ${chrome.capBottom});
    ${bevelOut}

    &:hover,
    &.Mui-focusVisible,
    &.Mui-active {
      box-shadow:
        inset 1px 1px 0 ${chrome.caseLight},
        inset -1px -1px 0 ${chrome.caseShadow},
        inset 2px 2px 0 ${chrome.caseHi},
        inset -2px -2px 0 ${chrome.caseMid};
    }
  }
`;

const transportButton = `
  border-radius: 2px;
  background: linear-gradient(180deg, ${chrome.capTop}, ${chrome.capBottom});
  ${bevelOut}

  &:hover {
    background: linear-gradient(180deg, #fffdf5, ${chrome.capMid});
  }

  &:active {
    background: linear-gradient(180deg, ${chrome.capBottom}, ${chrome.capMid});
    ${bevelIn}
  }
`;

export const playButtonStyles = css`
  ${transportButton}
  color: #1d7a34;
  width: ${px(9)}px;
  height: ${px(9)}px;

  &.Mui-disabled {
    background: ${chrome.case};
    color: ${chrome.caseShadow};
    ${bevelOut}
  }
`;

export const stopButtonStyles = css`
  ${transportButton}
  color: ${chrome.led};
  width: ${px(9)}px;
  height: ${px(9)}px;
`;

export const clearButtonStyles = css`
  ${transportButton}
  color: ${chrome.ink};
  width: ${px(8)}px;
  height: ${px(8)}px;
`;

/** Numeric readout: a sunken LCD-ish field, monospaced like a panel meter. */
export const readoutStyles = css`
  ${caption}
  font-size: ${px(3.2)}px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: ${px(10)}px;
  padding: ${px(0.4)}px ${px(1.4)}px;
  text-align: center;
  background: ${chrome.caseHi};
  ${bevelIn}
`;

export const labelStyles = css`
  ${caption}
`;

export const bpmValueStyles = css`
  ${readoutStyles}
`;

export const midiSelectStyles = css`
  min-width: ${px(44)}px;

  .MuiOutlinedInput-root {
    ${caption}
    font-size: ${px(2.6)}px;
    text-transform: none;
    background: ${chrome.caseLow};
    border-radius: 3px;
    ${bevelIn}

    fieldset {
      border: none;
    }
  }

  .MuiSelect-icon {
    color: ${chrome.inkDim};
  }

  /* Legend pad-printed on the shell above the insert */
  .MuiInputLabel-root {
    ${caption}
    font-size: ${px(1.8)}px;
    color: ${chrome.caseShadow};

    &.Mui-focused {
      color: ${chrome.ink};
    }
  }
`;
