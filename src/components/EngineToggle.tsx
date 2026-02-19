import { css } from '@emotion/react';
import { Box, Typography } from '@mui/material';
import { useSequencerStore } from '../store/sequencerStore';

const containerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const labelStyles = css`
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const buttonStyles = css`
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const activeButtonStyles = css`
  ${buttonStyles}
  background: rgba(102, 255, 204, 0.15);
  border-color: #66ffcc;
  color: #66ffcc;

  &:hover {
    background: rgba(102, 255, 204, 0.25);
    color: #66ffcc;
  }
`;

const versionStyles = css`
  color: rgba(102, 255, 204, 0.6);
  font-size: 10px;
  margin-left: -6px;
`;

interface EngineToggleProps {
  wasmReady: boolean;
  wasmVersion?: number;
}

export const EngineToggle = ({ wasmReady, wasmVersion }: EngineToggleProps) => {
  const engineType = useSequencerStore((s) => s.engineType);
  const setEngineType = useSequencerStore((s) => s._setEngineType);

  return (
    <Box css={containerStyles}>
      <Typography css={labelStyles}>Engine</Typography>
      <button
        css={engineType === 'typescript' ? activeButtonStyles : buttonStyles}
        onClick={() => setEngineType('typescript')}
      >
        TS
      </button>
      <button
        css={engineType === 'wasm' ? activeButtonStyles : buttonStyles}
        onClick={() => setEngineType('wasm')}
        disabled={!wasmReady}
      >
        WASM
      </button>
      {wasmReady && wasmVersion != null && (
        <Typography css={versionStyles}>
          v{(wasmVersion / 1000).toFixed(1)}
        </Typography>
      )}
    </Box>
  );
};
