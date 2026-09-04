import { describe, expect, it } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';
import { PaperTradingEngine, EXECUTION_PROFILE } from '../src/trading/PaperTradingEngine.js';
import { TradingEvents } from '../src/trading/TradingEvents.js';

const candle = {
  time: 1000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  symbol: 'BTCUSD',
};

describe('BacktestRunner event-order failures', () => {
  it('propagates an execution-profile mutation from an earlier BAR_CLOSE listener', () => {
    const engine = new PaperTradingEngine({
      executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST,
      feeRate: 0,
    });
    const strategy = { onBar: () => [], reset() {} };

    const unsubscribe = engine.on(TradingEvents.BAR_CLOSE, () => {
      engine.setExecutionProfile(EXECUTION_PROFILE.MANUAL_REPLAY);
    });
    const runner = new BacktestRunner({ engine, strategy, symbol: 'BTCUSD' });

    expect(() => runner.processBar(candle, 0)).toThrow(/RESEARCH_BACKTEST/);
    expect(engine.getLatestCandleIndex()).toBe(0);

    unsubscribe();
    runner.destroy();
  });
});
