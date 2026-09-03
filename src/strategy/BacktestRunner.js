import { PaperTradingEngine, EXECUTION_PROFILE, EXECUTION_TIMING } from '../trading/PaperTradingEngine.js';
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
      executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST,
    });

    // An injected engine is part of the experiment definition. Do not silently
    // accept manual-replay semantics or same-bar timing here, because that can
    // turn a strategy signal into lookahead execution.
    if (this.engine.executionProfile !== EXECUTION_PROFILE.RESEARCH_BACKTEST || this.engine.executionTiming !== EXECUTION_TIMING.NEXT_BAR_OPEN) {
      throw new Error(`BacktestRunner requires ${EXECUTION_PROFILE.RESEARCH_BACKTEST} with ${EXECUTION_TIMING.NEXT_BAR_OPEN} timing`);
    }

    // Single canonical orchestration path: subscribe strategy strictly to PaperTradingEngine's BAR_CLOSE.
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
   * Directs candle into PaperTradingEngine -> engine emits canonical BAR_CLOSE
   * -> strategy evaluates finalized bar and enqueues intents for T+1 execution.
   */
  processBar(candle, index = null) {
    if (!candle || typeof candle !== 'object') throw new TypeError('BacktestRunner.processBar expects a candle object');
    if (candle.symbol != null && candle.symbol !== this.symbol) {
      throw new Error(`BacktestRunner symbol mismatch: expected ${this.symbol}, got ${candle.symbol}`);
    }
    const idx = Number.isFinite(index) ? index : (this.engine.getLatestCandleIndex() + 1);
    this.engine.onMarketCandle({ candle, index: idx, symbol: this.symbol });
    return { intents: this._lastIntents };
  }

  /**
   * Each run is an independent research experiment by default.
   * Pass reset:false only when intentionally continuing an existing session.
   */
  run(candles, { reset = true } = {}) {
    if (!Array.isArray(candles)) throw new TypeError('BacktestRunner.run expects an array of candles');
    if (reset) this.reset();
    for (let i = 0; i < candles.length; i++) {
      this.processBar(candles[i], i);
    }
    return this.getResults();
  }

  getResults() {
    const allOrders = this.engine.getOrders();
    const pendingIntents = allOrders.filter(o => o.status === ORDER_STATUSES.PENDING);
    const terminalIndex = this.engine.getLatestCandleIndex();
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
    if (typeof this.strategy.reset === 'function') this.strategy.reset();
    this.engine.resetAll({ clearMarket: true });
    this._lastIntents = [];
  }
}
