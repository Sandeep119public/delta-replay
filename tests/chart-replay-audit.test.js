import { describe, it, expect, vi } from 'vitest';
import { ChartManager } from '../src/chart/ChartManager.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ReplayControls } from '../src/ui/ReplayControls.js';
import { ReplayEvents } from '../src/replay/ReplayEvents.js';
import { ReplayStatus } from '../src/replay/ReplayState.js';

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

function makeCandles(count, startSec = 1700000000) {
  return Array.from({ length: count }, (_, i) => ({
    time: startSec + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1000
  }));
}

describe('Chart and Replay Deep Audit Fixes', () => {
  describe('ChartManager flat candle spread calculation', () => {
    it('scales flat candle spread proportionally for low-priced coins ($0.50)', () => {
      const cm = Object.create(ChartManager.prototype);
      const flatCandleLowPrice = [{
        time: 1700000000,
        open: 0.50,
        high: 0.50,
        low: 0.50,
        close: 0.50,
        volume: 100
      }];
      const prepared = cm._prepareCandlesForChart(flatCandleLowPrice);
      expect(prepared).toHaveLength(1);
      const c = prepared[0];
      // High and low should have a small non-zero spread, but NOT artificially inflated by $0.20
      expect(c.high).toBeGreaterThan(c.low);
      const spread = c.high - c.low;
      expect(spread).toBeLessThan(0.01); // should be around 0.50 * 0.00015 = 0.000075
      expect(c.high).toBeCloseTo(0.50, 2);
      expect(c.low).toBeCloseTo(0.50, 2);
    });

    it('scales flat candle spread for high-priced coins ($65,000 BTC)', () => {
      const cm = Object.create(ChartManager.prototype);
      const flatCandleHighPrice = [{
        time: 1700000000,
        open: 65000,
        high: 65000,
        low: 65000,
        close: 65000,
        volume: 100
      }];
      const prepared = cm._prepareCandlesForChart(flatCandleHighPrice);
      expect(prepared).toHaveLength(1);
      const c = prepared[0];
      expect(c.high).toBeGreaterThan(c.low);
      const spread = c.high - c.low;
      // 65000 * 0.00015 = 9.75
      expect(spread).toBeGreaterThan(5);
      expect(spread).toBeLessThan(15);
    });
  });

  describe('ReplayControls speed selection in READY state', () => {
    it('enables speed selection when data is loaded in READY state', () => {
      const dom = makeMockDOM();
      const engine = new ReplayEngine();
      new ReplayControls({ ...dom, engine });

      // In initial IDLE state with 0 candles, speedSelect is disabled
      expect(dom.speedSelect.disabled).toBe(true);

      // Load data -> READY state
      engine.load(makeCandles(10));
      expect(engine.getState().status).toBe(ReplayStatus.READY);
      expect(dom.speedSelect.disabled).toBe(false); // Should now be ENABLED so user can pick speed before play!
    });
  });

  describe('ReplayEngine state transitions and Spacebar / Header logic', () => {
    it('supports starting replay and transitioning to PAUSED then PLAYING', () => {
      const engine = new ReplayEngine();
      engine.load(makeCandles(10));
      expect(engine.getState().status).toBe(ReplayStatus.READY);

      // Simulate start at index 2
      engine.start(2);
      expect(engine.getState().status).toBe(ReplayStatus.PAUSED);
      expect(engine.getState().currentIndex).toBe(2);

      // Simulate play
      engine.play();
      expect(engine.getState().status).toBe(ReplayStatus.PLAYING);

      // Simulate pause
      engine.pause();
      expect(engine.getState().status).toBe(ReplayStatus.PAUSED);
    });

    it('handles reset back to startIndex correctly', () => {
      const engine = new ReplayEngine();
      engine.load(makeCandles(10));
      engine.start(3);
      engine.stepForward();
      engine.stepForward();
      expect(engine.getState().currentIndex).toBe(5);

      engine.reset();
      expect(engine.getState().currentIndex).toBe(3);
      expect(engine.getState().status).toBe(ReplayStatus.PAUSED);
    });
  });
});
