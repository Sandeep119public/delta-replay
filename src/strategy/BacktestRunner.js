import { PaperTradingEngine, EXECUTION_TIMING } from '../trading/PaperTradingEngine.js';
import { TradingEvents } from '../trading/TradingEvents.js';
import { ORDER_STATUSES } from '../trading/Order.js';

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

    // Single canonical orchestration path: subscribe strategy strictly to PaperTradingEngine's BAR_CLOSE
    this._lastIntents = [];
    this._unsubBarClose = this.engine.on(TradingEvents.BAR_CLOSE, (barEvent) => {
      const intents = this.strategy.onBar(barEvent) || [];
      this._lastIntents = intents;
      for (const intent of intents) {
        this.engine.submitIntent(intent);
      }
    });
  }

  /**
   * Lookahead-free quantitative pipeline:
   * Directs candle into PaperTradingEngine -> engine emits single canonical BAR_CLOSE
   * -> subscribed strategy evaluates lookahead-free and enqueues intents for T+1 execution.
   */
  processBar(candle, index = null) {
    const idx = Number.isFinite(index) ? index : (this.engine._latestCandleIndex + 1);
    this.engine.onMarketCandle({ candle, index: idx, symbol: this.symbol });
    return { intents: this._lastIntents };
  }

  run(candles) {
    for (let i = 0; i < candles.length; i++) {
      this.processBar(candles[i], i);
    }
    return this.getResults();
  }

  getResults() {
    const allOrders = this.engine.getOrders();
    const pendingIntents = allOrders.filter(o => o.status === ORDER_STATUSES.PENDING);
    const terminalIndex = this.engine._latestCandleIndex;
    const terminalOrders = pendingIntents.filter(o => o.createdIndex === terminalIndex);
    return {
      summary: { ...this.engine.getBacktestSummary(), unfilledTerminalOrders: terminalOrders.length },
      trades: this.engine.getTrades(),
      unfilledOrders: pendingIntents,
      unfilledTerminalOrders: terminalOrders,
      account: this.engine.getAccountSnapshot(),
    };
  }

  destroy() {
    if (this._unsubBarClose) {
      this._unsubBarClose();
      this._unsubBarClose = null;
    }
  }

  reset() {
    this.strategy.reset();
    this.engine.resetAll({ clearMarket: true });
    this._lastIntents = [];
  }
}
