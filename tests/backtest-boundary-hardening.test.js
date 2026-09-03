import { describe, it, expect } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';
import { PaperTradingEngine, EXECUTION_PROFILE } from '../src/trading/PaperTradingEngine.js';

const candle = (time, symbol = undefined) => ({
  ...(symbol ? { symbol } : {}),
  time,
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: 10,
});

const strategy = {
  onBar: () => [],
  reset: () => {},
};

describe('BacktestRunner boundary hardening', () => {
  it('rejects an injected manual-replay engine instead of silently permitting lookahead execution', () => {
    const engine = new PaperTradingEngine();
    expect(engine.executionProfile).toBe('MANUAL_REPLAY');
    expect(() => new BacktestRunner({ strategy, engine })).toThrow(/RESEARCH_BACKTEST/);
  });

  it('accepts an explicitly configured research engine', () => {
    const engine = new PaperTradingEngine({
      executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST,
    });
    expect(() => new BacktestRunner({ strategy, engine })).not.toThrow();
  });

  it('rejects a candle whose symbol conflicts with the runner symbol', () => {
    const runner = new BacktestRunner({ strategy, symbol: 'BTCUSDT' });
    expect(() => runner.processBar(candle(1000, 'ETHUSDT'), 0)).toThrow(/symbol mismatch/i);
    runner.destroy();
  });

  it('still accepts symbol-less candles for single-symbol datasets', () => {
    const runner = new BacktestRunner({ strategy, symbol: 'BTCUSDT' });
    expect(() => runner.processBar(candle(1000), 0)).not.toThrow();
    runner.destroy();
  });
});
