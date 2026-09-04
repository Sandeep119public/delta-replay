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

    if (this.engine.executionProfile !== EXECUTION_PROFILE.RESEARCH_BACKTEST || this.engine.executionTiming !== EXECUTION_TIMING.NEXT_BAR_OPEN) {
      throw new Error(`BacktestRunner requires ${EXECUTION_PROFILE.RESEARCH_BACKTEST} with ${EXECUTION_TIMING.NEXT_BAR_OPEN} timing`);
    }

    this._lastIntents = [];
    this._strategyError = null;
    this._strategyErrorCaptured = false;
    this._unsubBarClose = this.engine.on(TradingEvents.BAR_CLOSE, (barEvent) => {
      this._assertResearchExecution();
      try {
        const intents = this.strategy.onBar(barEvent);
        if (intents != null && typeof intents[Symbol.iterator] !== 'function') {
          throw new TypeError('BacktestRunner strategy.onBar must return an iterable of intents');
        }
        const normalizedIntents = intents || [];
        this._lastIntents = normalizedIntents;
        for (const intent of normalizedIntents) {
          if (intent?.symbol != null && intent.symbol !== this.symbol) {
            this.engine._reject?.('SYMBOL_MISMATCH', `BacktestRunner symbol mismatch: expected ${this.symbol}, got ${intent.symbol}`);
            continue;
          }
          this.engine.submitIntent({ ...intent, symbol: this.symbol });
        }
      } catch (err) {
        this._strategyErrorCaptured = true;
        this._strategyError = err;
      }
    });
  }

  _assertResearchExecution() {
    if (this.engine.executionProfile !== EXECUTION_PROFILE.RESEARCH_BACKTEST || this.engine.executionTiming !== EXECUTION_TIMING.NEXT_BAR_OPEN) {
      throw new Error(`BacktestRunner requires ${EXECUTION_PROFILE.RESEARCH_BACKTEST} with ${EXECUTION_TIMING.NEXT_BAR_OPEN} timing`);
    }
  }

  processBar(candle, index = null) {
    if (!candle || typeof candle !== 'object') throw new TypeError('BacktestRunner.processBar expects a candle object');
    this._assertResearchExecution();
    if (candle.symbol != null && candle.symbol !== this.symbol) {
      throw new Error(`BacktestRunner symbol mismatch: expected ${this.symbol}, got ${candle.symbol}`);
    }
    this._strategyError = null;
    this._strategyErrorCaptured = false;
    this._lastIntents = [];
    const idx = Number.isFinite(index) ? index : (this.engine.getLatestCandleIndex() + 1);
    this.engine.onMarketCandle({ candle, index: idx, symbol: this.symbol });
    if (this._strategyErrorCaptured) {
      const err = this._strategyError;
      this._strategyError = null;
      this._strategyErrorCaptured = false;
      throw err;
    }
    return { intents: this._lastIntents };
  }

  run(candles, { reset = true } = {}) {
    if (!Array.isArray(candles)) throw new TypeError('BacktestRunner.run expects an array of candles');
    if (reset) this.reset();
    const startIndex = reset ? 0 : this.engine.getLatestCandleIndex() + 1;
    for (let i = 0; i < candles.length; i++) {
      this.processBar(candles[i], startIndex + i);
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
    this._strategyError = null;
    this._strategyErrorCaptured = false;
    this._lastIntents = [];
  }
}
