import { describe, it, expect } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';
import { PaperTradingEngine, EXECUTION_PROFILE, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';

const candle = (time, open = 100) => ({ time, open, high: open, low: open, close: open, volume: 1, symbol: 'BTCUSDT' });

const strategy = { onBar: () => [], reset() {} };

describe('BacktestRunner execution lock', () => {
  it('rejects runtime execution-profile changes before processing another bar', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    const runner = new BacktestRunner({ strategy, engine, symbol: 'BTCUSDT', feeRate: 0 });

    runner.processBar(candle(1000), 0);
    engine.setExecutionProfile(EXECUTION_PROFILE.MANUAL_REPLAY);

    expect(() => runner.processBar(candle(1060, 101), 1)).toThrow(/RESEARCH_BACKTEST/);
    expect(engine.getLatestCandleIndex()).toBe(0);
    runner.destroy();
  });

  it('rejects runtime timing changes even when the research profile remains selected', () => {
    const engine = new PaperTradingEngine({ executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST });
    const runner = new BacktestRunner({ strategy, engine, symbol: 'BTCUSDT', feeRate: 0 });

    engine.setExecutionTiming(EXECUTION_TIMING.IMMEDIATE_CLOSE);

    expect(() => runner.processBar(candle(1000), 0)).toThrow(/NEXT_BAR_OPEN/);
    expect(engine.getLatestCandleIndex()).toBe(-1);
    runner.destroy();
  });
});
