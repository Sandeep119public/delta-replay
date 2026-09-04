import { describe, expect, it } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';

const candles = [
  { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 1060, open: 100, high: 102, low: 98, close: 101, volume: 1 },
];

describe('BacktestRunner strategy errors', () => {
  it('propagates a strategy exception to the backtest caller', () => {
    const error = new Error('strategy exploded');
    const strategy = {
      onBar: () => { throw error; },
      reset() {},
    };
    const runner = new BacktestRunner({ strategy, symbol: 'BTCUSD', feeRate: 0 });

    expect(() => runner.processBar(candles[0], 0)).toThrow(error);
    expect(runner.engine.getLatestCandleIndex()).toBe(0);
    runner.destroy();
  });

  it('does not leak a prior strategy error into the next bar', () => {
    let calls = 0;
    const strategy = {
      onBar: () => {
        calls++;
        if (calls === 1) throw new Error('first failure');
        return [];
      },
      reset() {},
    };
    const runner = new BacktestRunner({ strategy, symbol: 'BTCUSD', feeRate: 0 });

    expect(() => runner.processBar(candles[0], 0)).toThrow(/first failure/);
    expect(() => runner.processBar(candles[1], 1)).not.toThrow();
    runner.destroy();
  });
});
