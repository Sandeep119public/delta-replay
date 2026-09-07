import { describe, it, expect, vi } from 'vitest';
import { ChartManager } from '../src/chart/ChartManager.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ReplayControls } from '../src/ui/ReplayControls.js';
import { ReplayStatus } from '../src/replay/ReplayState.js';
import { createReplayUIPort } from '../src/app/ReplayUIPort.js';

function makeMockDOM() {
  const elements = {
    playBtn: { addEventListener: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() }, disabled: false },
    pauseBtn: { addEventListener: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() }, disabled: true },
    stepBtn: { addEventListener: vi.fn(), disabled: true },
    resetBtn: { addEventListener: vi.fn(), disabled: true },
    startReplayBtn: { addEventListener: vi.fn(), dataset: {}, disabled: true, textContent: '' },
    speedSelect: { addEventListener: vi.fn(), value: '1', disabled: true },
    statusEl: { textContent: '', className: '' },
  };
  return elements;
}
