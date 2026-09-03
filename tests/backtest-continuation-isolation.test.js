import { describe, it, expect } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';

const c = (time, open, symbol = 'BTCUSDT') => ({
  time,
  open,
  high: open,
  low: open,
  close: open,
  volume: 1,
  symbol,
});

class BuyOnlyFirstResearchBar {
  onBar(bar) {
    if (bar.index === 0) return [{ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 1 }];
    return [];
  }
  reset() {}
}

class WrongSymbolStrategy {
  onBar() {
    return [{ symbol: 'ETHUSDT', side: 'BUY', type: 'MARKET', quantity: 1 }];
  }
  reset() {}
}

describe('BacktestRunner continuation and symbol isolation', () => {
  it('continues from the next engine index when reset:false', () => {
    const runner = new BacktestRunner({ strategy: new BuyOnlyFirstResearchBar(), symbol: 'BTCUSDT', feeRate: 0 });

    runner.run([c(1000, 100)]);
    expect(runner.engine.getLatestCandleIndex()).toBe(0);
    expect(runner.engine.getPosition('BTCUSDT')).toBeNull();

    runner.run([c(1060, 110)], { reset: false });
    const position = runner.engine.getPosition('BTCUSDT');
    expect(runner.engine.getLatestCandleIndex()).toBe(1);
    expect(position).not.toBeNull();
    expect(position.entryPrice).toBe(110);
    runner.destroy();
  });

  it('does not submit a strategy intent for another symbol', () => {
    const runner = new BacktestRunner({ strategy: new WrongSymbolStrategy(), symbol: 'BTCUSDT', feeRate: 0 });
    runner.run([c(1000, 100)]);
    expect(runner.engine.getOrders()).toHaveLength(0);
    expect(runner.engine.getPosition('BTCUSDT')).toBeNull();
    expect(runner.engine.getPosition('ETHUSDT')).toBeNull();
    runner.destroy();
  });
});
