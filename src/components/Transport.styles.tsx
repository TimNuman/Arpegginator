import { css } from "@emotion/react";

export const transportStyles = css`
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 24px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;

export const controlGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const bpmSliderStyles = css`
  width: 150px;
  color: #66ffcc;

  .MuiSlider-thumb {
    background-color: #66ffcc;
  }

  .MuiSlider-track {
    background-color: #66ffcc;
  }

  .MuiSlider-rail {
    background-color: rgba(102, 255, 204, 0.3);
  }
`;

export const playButtonStyles = css`
  background: linear-gradient(145deg, #33ff66, #22cc44);
  color: #000;
  width: 48px;
  height: 48px;

  &:hover {
    background: linear-gradient(145deg, #44ff77, #33dd55);
  }

  &.Mui-disabled {
    background: linear-gradient(145deg, #444, #333);
    color: rgba(255, 255, 255, 0.3);
  }
`;

export const stopButtonStyles = css`
  background: linear-gradient(145deg, #ff3366, #cc2244);
  color: #fff;
  width: 48px;
  height: 48px;

  &:hover {
    background: linear-gradient(145deg, #ff4477, #dd3355);
  }
`;

export const clearButtonStyles = css`
  background: linear-gradient(145deg, #666, #444);
  color: #fff;
  width: 40px;
  height: 40px;

  &:hover {
    background: linear-gradient(145deg, #777, #555);
  }
`;

export const labelStyles = css`
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

export const bpmValueStyles = css`
  color: #66ffcc;
  font-size: 24px;
  font-weight: bold;
  font-family: "Courier New", monospace;
  min-width: 60px;
  text-align: center;
`;

export const midiSelectStyles = css`
  min-width: 200px;

  .MuiOutlinedInput-root {
    color: #fff;
    background: rgba(0, 0, 0, 0.3);

    fieldset {
      border-color: rgba(255, 255, 255, 0.2);
    }

    &:hover fieldset {
      border-color: rgba(255, 255, 255, 0.4);
    }

    &.Mui-focused fieldset {
      border-color: #66ffcc;
    }
  }

  .MuiInputLabel-root {
    color: rgba(255, 255, 255, 0.5);
  }

  .MuiSelect-icon {
    color: rgba(255, 255, 255, 0.5);
  }
`;
