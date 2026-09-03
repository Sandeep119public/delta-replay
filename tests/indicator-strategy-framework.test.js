import { describe, it, expect } from 'vitest';
import { SMA } from '../src/indicators/SMA.js';
import { EMA } from '../src/indicators/EMA.js';
import { Strategy } from '../src/strategy/Strategy.js';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';

function makeCandles() {
  const candles = [];
  let price = 100;
  for (let i = 0; i < 30; i++) {
    const change = (i % 2 === 0 ? 2 : -1) * (i > 15 ? -1 : 1);
    const open = price;
    price += change;
    const high = Math.max(open, price) + 1;
    const low = Math.min(open, price) - 1;
    const close = price;
    candles.push({
      time: 1000 + i * 60,
      open,
      high,
      low,
      close,
      volume: 100 + i,
    });
  }
  return candles;
}

// Simple Moving Average Crossover Strategy for verification
class SmaCrossStrategy extends Strategy {
  constructor() {
    super('SmaCross');
    this.fastSma = this.addIndicator('fast', new SMA(3));
    this.slowSma = this.addIndicator('slow', new SMA(5));
    this.positionState = 'FLAT';
  }

  evaluate(barEvent) {
    if (!this.fastSma.isReady() || !this.slowSma.isReady()) {
      return [];
    }

    const fast = this.fastSma.value;
    const slow = this.slowSma.value;

    if (fast > slow && this.positionState === 'FLAT') {
      this.positionState = 'LONG';
      return [this.createIntent({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 })];
    } else if (fast < slow && this.positionState === 'LONG') {
      this.positionState = 'FLAT';
      return [this.createIntent({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 })];
    }
    return [];
  }
}

describe('Phase 5 — Indicator & Strategy Framework', () => {
  describe('1. Lookahead-free Indicators (Invariant 9)', () => {
    it('calculates SMA and EMA strictly from finalized bars without lookahead', () => {
      const sma = new SMA(3);
      expect(sma.isReady()).toBe(false);

      sma.update({ close: 10 });
      expect(sma.isReady()).toBe(false);
      sma.update({ close: 20 });
      expect(sma.isReady()).toBe(false);
      sma.update({ close: 30 });
      expect(sma.isReady()).toBe(true);
      expect(sma.value).toBe(20); // (10+20+30)/3

      sma.update({ close: 40 });
      expect(sma.value).toBe(30); // (20+30+40)/3
    });

    it('EMA updates sequentially and deterministically', () => {
      const ema = new EMA(3);
      ema.update({ close: 10 });
      ema.update({ close: 20 });
      ema.update({ close: 30 });
      expect(ema.value).toBe(20); // initial SMA

      // multiplier = 2 / (3 + 1) = 0.5
      // current = (40 - 20) * 0.5 + 20 = 30
      ema.update({ close: 40 });
      expect(ema.value).toBe(30);
    });
  });

  describe('2. Lookahead-free Strategy Execution Pipeline (Invariants 10 & 11)', () => {
    it('timestamped intents generated at bar T execute strictly at Open(T+1)', () => {
      const strategy = new SmaCrossStrategy();
      const runner = new BacktestRunner({ strategy });
      const candles = makeCandles();

      const results = runner.run(candles);
      expect(results.trades.length).toBeGreaterThan(0);

      // Verify that every trade entry price matches the NEXT candle open
      for (const trade of results.trades) {
        // Find entry candle
        const entryCandle = candles.find(c => c.time === trade.openedAt);
        expect(entryCandle).toBeDefined();
        // Invariant 11: Filled at Open(T+1), not T close
        expect(trade.entryPrice).toBe(entryCandle.open);
      }
    });
  });

  describe('3. Determinism & Byte-Equivalence (Invariant 12)', () => {
    it('replaying the same backtest produces identical byte-equivalent trades and snapshots', () => {
      const candles = makeCandles();

      const strategyA = new SmaCrossStrategy();
      const runnerA = new BacktestRunner({ strategy: strategyA });
      const resultsA = runnerA.run(candles);

      const strategyB = new SmaCrossStrategy();
      const runnerB = new BacktestRunner({ strategy: strategyB });
      const resultsB = runnerB.run(candles);

      // Invariant 12: Byte-equivalent simulation results
      const jsonA = JSON.stringify(resultsA);
      const jsonB = JSON.stringify(resultsB);
      expect(jsonA).toEqual(jsonB);
    });
  });
});
