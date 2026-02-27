import { css } from "@emotion/react";

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

export const gridContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  background: linear-gradient(145deg, #1a1a1a, #0d0d0d);
  border-radius: 12px;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
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

export const modifierKeyStyles = css`
  width: 40px;
  height: 24px;
  border-radius: 4px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s ease;
`;

export const modifierKeyActiveStyles = css`
  background: linear-gradient(145deg, #4a4a4a, #3a3a3a);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
`;

export const debugStyles = css`
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-family: monospace;
  padding: 8px 20px;
  display: flex;
  justify-content: space-between;
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

export const oledScreenStyles = css`
  width: calc(4 * 44px - 4px);
  height: calc(3 * 44px - 4px);
  background: #000;
  border-radius: 4px;
  border: 2px solid #1a1a1a;
  box-shadow:
    inset 0 0 20px rgba(0, 0, 0, 0.8),
    0 2px 8px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  padding: 8px;
  font-family: "SF Mono", "Menlo", "Monaco", monospace;
  color: #0ff;
  font-size: 11px;
  overflow: hidden;
`;

export const oledRowStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 1;
  min-height: 0;
`;

export const oledLabelStyles = css`
  color: rgba(0, 255, 255, 0.5);
  font-size: 9px;
  text-transform: uppercase;
`;

export const oledValueStyles = css`
  color: #0ff;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
`;

export const oledHighlightStyles = css`
  color: #ff0;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(255, 255, 0, 0.5);
`;

export const oledHighlightRedStyles = css`
  color: #f55;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(255, 85, 85, 0.5);
`;

export const rotaryEncoderStyles = css`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: 3px solid #333;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.5),
    inset 0 2px 4px rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  cursor: pointer;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(145deg, #222, #181818);
    border: 2px solid #2a2a2a;
  }

  &::after {
    content: "";
    position: absolute;
    width: 4px;
    height: 20px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    top: 12px;
  }
`;

export const rotaryKnobStyles = css`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(145deg, #3a3a3a, #252525);
  border: 1px solid #444;
  z-index: 1;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
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
  border-radius: 4px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: 1px solid #333;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s ease;
  user-select: none;

  &:hover {
    background: linear-gradient(145deg, #3a3a3a, #2a2a2a);
    color: rgba(255, 255, 255, 0.8);
  }

  &:active {
    background: linear-gradient(145deg, #4a4a4a, #3a3a3a);
    color: rgba(255, 255, 255, 1);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
  }
`;
