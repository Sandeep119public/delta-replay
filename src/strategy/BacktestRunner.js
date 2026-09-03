import { PaperTradingEngine, EXECUTION_TIMING } from '../trading/PaperTradingEngine.js';

export class BacktestRunner {
  constructor({
    strategy,
    engine = null,
    symbol = 'BTCUSD',
    startingBalance = 10000,
    feeRate = 0.0005,
    marginRate = 0.1,
    maintMarginRate = 0.05,
  }) {
    this.strategy = strategy;
    this.symbol = symbol;
    this.engine = engine || new PaperTradingEngine({
      startingBalance,
      feeRate,
      marginRate,
      maintMarginRate,
      executionTiming: EXECUTION_TIMING.NEXT_BAR_OPEN,
    });
  }

  /**
   * Lookahead-free quantitative pipeline:
   * 1. Feed candle to trading engine (which fills eligible pending orders at T+1 Open and finalizes bar T)
   * 2. Feed immutable finalized bar into strategy -> produces OrderIntents
   * 3. Submit intents to trading engine (fill eligibility begins strictly on T+1)
   */
  processBar(candle, index = null) {
    const idx = Number.isFinite(index) ? index : (this.engine._latestCandleIndex + 1);

    // 1. Process bar on PaperTradingEngine
    this.engine.onMarketCandle({ candle, index: idx, symbol: this.symbol });

    // 2. Frozen canonical bar event for Strategy & Indicators (Invariant 9 & 10)
    const barEvent = Object.freeze({
      index: idx,
      timestamp: candle.time,
      candle: Object.freeze({ ...candle }),
      phase: 'BAR_CLOSE',
    });

    // 3. Strategy evaluates on finalized bar
    const intents = this.strategy.onBar(barEvent) || [];

    // 4. Submit intents into engine (fill eligibility begins strictly on T+1)
    for (const intent of intents) {
      this.engine.submitIntent(intent);
    }

    return { barEvent, intents };
  }

  run(candles) {
    for (let i = 0; i < candles.length; i++) {
      this.processBar(candles[i], i);
    }
    return this.getResults();
  }

  getResults() {
    return {
      summary: this.engine.getBacktestSummary(),
      trades: this.engine.getTrades(),
      account: this.engine.getAccountSnapshot(),
    };
  }

  reset() {
    this.strategy.reset();
    this.engine.resetAll({ clearMarket: true });
  }
}
