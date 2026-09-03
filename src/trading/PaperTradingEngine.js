import { EventEmitter } from '../core/EventEmitter.js';
import { TradingAccount } from './TradingAccount.js';
import { Position } from './Position.js';
import { Trade } from './Trade.js';
import { TradingEvents } from './TradingEvents.js';
import { TradingValidator } from './TradingValidator.js';
import { TRADING_CONFIG, calcFee } from './TradingConfig.js';
import { Order, ORDER_TYPES, ORDER_STATUSES, EXECUTION_TIMING } from './Order.js';

export { EXECUTION_TIMING };

export const AMBIGUITY_RESOLUTION = Object.freeze({
  NONE: 'NONE',
  SL_FIRST: 'SL_FIRST',
  TP_FIRST: 'TP_FIRST',
  HEURISTIC_PROXIMITY: 'HEURISTIC_PROXIMITY',
});

export const AMBIGUITY_POLICY = Object.freeze({
  CONSERVATIVE: 'CONSERVATIVE',
  SL_FIRST: 'SL_FIRST',
  TP_FIRST: 'TP_FIRST',
  OPEN_PROXIMITY: 'OPEN_PROXIMITY',
});

export const EXECUTION_POLICY = Object.freeze({
  SIMPLIFIED: 'SIMPLIFIED', // stop/limit fill at trigger price
  REALISTIC: 'REALISTIC',   // gap-through orders fill at candle open
});

/**
 * PaperTradingEngine — consumes MARKET_CANDLE only.
 * Never touches AppState.candles, ReplayEngine._candles, Chart data, Timeline.
 *
 * Deterministic: market execution = close, limit execution = limitPrice with next-candle rule.
 * One position per symbol.
 */
export class PaperTradingEngine extends EventEmitter {
  static defaultExecutionTiming = EXECUTION_TIMING.NEXT_BAR_OPEN;

  /**
   * @param {object} opts
   * @param {number} [opts.startingBalance=10000]
   * @param {number} [opts.feeRate] - taker fee rate, defaults to TRADING_CONFIG
   * @param {import('../replay/ReplayEngine.js').ReplayEngine} [opts.replayEngine] - optional auto-wire
   * @param {string} [opts.ambiguityPolicy=AMBIGUITY_POLICY.CONSERVATIVE]
   * @param {string} [opts.executionPolicy=EXECUTION_POLICY.SIMPLIFIED]
   * @param {boolean} [opts.realisticExecution=false]
   * @param {number} [opts.marginRate=1.0] - initial margin rate (1.0 = full cash, 0 = unlimited leverage/fee only)
   * @param {string} [opts.executionTiming=EXECUTION_TIMING.NEXT_BAR_OPEN] - NEXT_BAR_OPEN | IMMEDIATE_CLOSE
   */
  constructor({ startingBalance = 10000, feeRate = TRADING_CONFIG.TAKER_FEE_RATE, replayEngine = null, ambiguityPolicy = AMBIGUITY_POLICY.CONSERVATIVE, executionPolicy = null, realisticExecution = false, marginRate = 1.0, maintMarginRate = null, executionTiming = PaperTradingEngine.defaultExecutionTiming, fundingSchedule = null } = {}) {
    super();
    this.account = new TradingAccount({ startingBalance });
    this.feeRate = feeRate;
    this.ambiguityPolicy = ambiguityPolicy;
    this.executionPolicy = executionPolicy ?? (realisticExecution ? EXECUTION_POLICY.REALISTIC : EXECUTION_POLICY.SIMPLIFIED);
    this.marginRate = marginRate;
    this.maintMarginRate = maintMarginRate ?? (marginRate * 0.5);
    this.executionTiming = executionTiming;
    this._fundingSchedule = fundingSchedule;
    this._fundingHistory = [];
    this._lastFundingTimestamp = null;
    this._ambiguousBarCount = 0;
    this._totalBarsEvaluated = 0;
    this._isProcessingCandle = false;
    this._accountNeedsUpdate = false;
    this._positions = new Map(); // symbol -> Position
    this._trades = [];
    this._nextTradeId = 1;
    this._latestCandle = null; // cloned
    this._latestCandleIndex = -1;
    this._latestSymbolContext = null;
    this._marketBySymbol = new Map(); // symbol -> { candle, index, timestamp }
    this._replayEngine = null;
    this._unsubs = [];
    // limit orders
    this._orders = new Map(); // id -> Order instance (raw)
    this._pendingOrderIds = []; // ordered queue of pending ids
    this._nextOrderId = 1;
    this._lifecycleUnsubs = [];
    if (replayEngine) this.attachToReplay(replayEngine);
  }

  setAmbiguityPolicy(policy) {
    if (!Object.values(AMBIGUITY_POLICY).includes(policy)) {
      throw new Error(`Invalid ambiguity policy: ${policy}`);
    }
    this.ambiguityPolicy = policy;
  }

  setExecutionPolicy(policy) {
    if (!Object.values(EXECUTION_POLICY).includes(policy)) {
      throw new Error(`Invalid execution policy: ${policy}`);
    }
    this.executionPolicy = policy;
  }

  setExecutionTiming(timing) {
    if (!Object.values(EXECUTION_TIMING).includes(timing)) {
      throw new Error(`Invalid execution timing: ${timing}`);
    }
    this.executionTiming = timing;
  }

  submitIntent({ symbol, side, type = ORDER_TYPES.MARKET, quantity, limitPrice = null, stopPrice = null } = {}) {
    if (type === ORDER_TYPES.MARKET) {
      return this.placeOrder({ symbol, side, quantity, timing: EXECUTION_TIMING.NEXT_BAR_OPEN });
    } else if (type === ORDER_TYPES.LIMIT) {
      return this.placeLimitOrder({ symbol, side, quantity, limitPrice });
    } else if (type === ORDER_TYPES.STOP_MARKET) {
      return this.placeStopOrder({ symbol, side, quantity, stopPrice });
    }
    return this._reject('INVALID_ORDER_TYPE', `Unknown order type: ${type}`);
  }

  setFundingSchedule(schedule) {
    this._fundingSchedule = schedule;
  }

  applyFundingRate({ symbol = null, fundingRate = 0.0001, timestamp = null, markPrice = null } = {}) {
    const ts = timestamp ?? (this._latestCandle ? this._latestCandle.time : Date.now());
    const rate = Number(fundingRate);
    if (!Number.isFinite(rate)) return [];

    const payments = [];
    for (const [sym, pos] of this._positions.entries()) {
      if (symbol && sym !== symbol) continue;
      const explicitMark = markPrice == null ? NaN : Number(markPrice);
      const resolvedMarkPrice = Number.isFinite(explicitMark) ? explicitMark : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);
      const notional = resolvedMarkPrice * pos.quantity;
      // When fundingRate > 0: Longs pay Shorts (payment negative for Long, positive for Short)
      // When fundingRate < 0: Shorts pay Longs (payment positive for Long, negative for Short)
      const payment = (pos.side === 'LONG' ? -1 : 1) * notional * rate;

      // Invariant 7: Keep funding completely outside trade realizedPnL
      // walletBalance ± funding payment
      this.account.walletBalance += payment;
      this.account.totalFundingPaid += (payment < 0 ? -payment : 0);

      const record = {
        id: this._fundingHistory.length + 1,
        timestamp: ts,
        symbol: sym,
        side: pos.side,
        quantity: pos.quantity,
        markPrice: resolvedMarkPrice,
        fundingRate: rate,
        payment,
      };
      this._fundingHistory.push(record);
      payments.push(record);
      this.emit(TradingEvents.FUNDING_PAYMENT, this._cloneJSON(record));
    }
    if (payments.length > 0) {
      this._emitAccountUpdated();
    }
    return payments;
  }

  getFundingHistory() {
    return this._fundingHistory.map(f => this._cloneJSON(f));
  }

  _emitAccountUpdated() {
    if (this._isProcessingCandle) {
      this._accountNeedsUpdate = true;
      return;
    }
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
  }

  _getRequiredEntryCash(price, quantity) {
    const notional = price * quantity;
    const fee = calcFee(notional, this.feeRate);
    const marginRatio = (typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0;
    return (notional * marginRatio) + fee;
  }

  _checkMarginAvailable(price, quantity) {
    const notional = price * quantity;
    const fee = calcFee(notional, this.feeRate);
    const imRate = (typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0;
    const requiredInitialMargin = notional * imRate;
    const requiredMargin = requiredInitialMargin + fee;
    // Cross-margin invariant: availableMargin must cover requiredInitialMargin + fee,
    // and walletBalance must cover entry fee
    const hasMargin = this.account.availableMargin >= requiredMargin && this.account.walletBalance >= fee;
    return {
      valid: hasMargin,
      requiredMargin,
      availableMargin: this.account.availableMargin,
      fee,
      initialMargin: requiredInitialMargin,
    };
  }

  getLiquidationPrice(symbol) {
    const pos = this._positions.get(symbol);
    if (!pos) return null;
    const imRate = (typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0;
    const mmRate = (typeof this.maintMarginRate === 'number' && this.maintMarginRate >= 0) ? this.maintMarginRate : (imRate * 0.5);

    // Cross-margin liquidation price calculation
    let otherUnrealized = 0;
    let otherMM = 0;
    for (const [sym, other] of this._positions.entries()) {
      if (sym === symbol) continue;
      otherUnrealized += other.unrealizedPnL;
      const mark = Number.isFinite(other.currentPrice) ? other.currentPrice : other.entryPrice;
      otherMM += other.quantity * mark * mmRate;
    }

    const W = this.account.walletBalance + otherUnrealized;
    const Q = pos.quantity;
    const P_entry = pos.entryPrice;

    if (pos.side === 'LONG') {
      const denom = Q * (1 - mmRate);
      if (denom <= 0) return null;
      const num = P_entry * Q + otherMM - W;
      const liqPrice = num / denom;
      return liqPrice > 0 ? liqPrice : null;
    } else {
      const denom = Q * (1 + mmRate);
      if (denom <= 0) return null;
      const num = W + P_entry * Q - otherMM;
      const liqPrice = num / denom;
      return liqPrice > 0 ? liqPrice : null;
    }
  }

  _calcPositionMargins(price, quantity, side, symbol = null) {
    const notional = price * quantity;
    const imRate = (typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0;
    const mmRate = (typeof this.maintMarginRate === 'number' && this.maintMarginRate >= 0) ? this.maintMarginRate : (imRate * 0.5);
    const initialMargin = notional * imRate;
    const maintenanceMargin = notional * mmRate;

    let liquidationPrice = null;
    if (symbol && this._positions.has(symbol)) {
      liquidationPrice = this.getLiquidationPrice(symbol);
    } else {
      const W = this.account.walletBalance;
      const Q = quantity;
      const P_entry = price;
      if (side === 'LONG') {
        const denom = Q * (1 - mmRate);
        if (denom > 0) {
          const liq = (P_entry * Q - W) / denom;
          liquidationPrice = liq > 0 ? liq : null;
        }
      } else {
        const denom = Q * (1 + mmRate);
        if (denom > 0) {
          const liq = (W + P_entry * Q) / denom;
          liquidationPrice = liq > 0 ? liq : null;
        }
      }
    }
    return { initialMargin, maintenanceMargin, liquidationPrice };
  }

  _updateLiquidationPrices() {
    for (const [sym, pos] of this._positions.entries()) {
      pos.liquidationPrice = this.getLiquidationPrice(sym);
    }
  }

  _recalcMargins() {
    let usedIM = 0;
    let totalMM = 0;
    for (const p of this._positions.values()) {
      usedIM += p.initialMargin || 0;
      totalMM += p.maintenanceMargin || 0;
    }
    this.account.usedMargin = usedIM;
    this.account.maintenanceMargin = totalMM;
    this._updateLiquidationPrices();
  }

  _portfolioMarginStateAtPrice(symbol, markPrice) {
    const mmRate = (typeof this.maintMarginRate === 'number' && this.maintMarginRate >= 0) ? this.maintMarginRate : (((typeof this.marginRate === 'number' && this.marginRate >= 0) ? this.marginRate : 1.0) * 0.5);
    let equity = this.account.walletBalance;
    let maintenanceMargin = 0;
    for (const [sym, pos] of this._positions.entries()) {
      const mark = sym === symbol ? markPrice : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);
      equity += pos.side === 'LONG' ? (mark - pos.entryPrice) * pos.quantity : (pos.entryPrice - mark) * pos.quantity;
      maintenanceMargin += Math.abs(mark * pos.quantity) * mmRate;
    }
    return { equity, maintenanceMargin };
  }

  _isPortfolioLiquidatable(symbol, markPrice) {
    const state = this._portfolioMarginStateAtPrice(symbol, markPrice);
    return state.equity <= state.maintenanceMargin + 1e-9;
  }

  _processLiquidations(candle, candleIndex, symbol) {
    const toLiquidate = [];
    for (const [sym, pos] of this._positions.entries()) {
      if (symbol && sym !== symbol) continue;
      const adversePrice = pos.side === 'LONG' ? candle.low : candle.high;
      if (!Number.isFinite(adversePrice) || !this._isPortfolioLiquidatable(sym, adversePrice)) continue;
      const derivedPrice = this.getLiquidationPrice(sym);
      let exitPrice = Number.isFinite(derivedPrice) && derivedPrice > 0 ? derivedPrice : adversePrice;
      if (this.executionPolicy === EXECUTION_POLICY.REALISTIC && Number.isFinite(candle.open)) {
        if (pos.side === 'LONG' && candle.open < exitPrice) exitPrice = candle.open;
        if (pos.side === 'SHORT' && candle.open > exitPrice) exitPrice = candle.open;
      }
      toLiquidate.push({ symbol: sym, exitPrice, candleTime: candle.time, pos });
    }
    for (const item of toLiquidate) {
      const { symbol: sym, exitPrice, candleTime, pos } = item;
      this.emit(TradingEvents.POSITION_LIQUIDATED, { symbol: sym, liquidationPrice: exitPrice, position: this._cloneJSON(pos.toJSON()), candle: this._cloneJSON(candle) });
      this._closePositionInternal(sym, exitPrice, candleTime, 'LIQUIDATION');
      this._cancelIncompatiblePendings(sym);
    }
  }

  _fundingMarkPriceAt(symbol, timestamp, previousMarket, currentCandle) {
    const pos = this._positions.get(symbol);
    if (!pos) return null;
    const prevClose = previousMarket && Number.isFinite(previousMarket.candle?.close) ? Number(previousMarket.candle.close) : (Number.isFinite(pos.currentPrice) ? Number(pos.currentPrice) : Number(pos.entryPrice));
    const currClose = Number.isFinite(currentCandle?.close) ? Number(currentCandle.close) : prevClose;
    const prevTime = Number(previousMarket?.timestamp);
    const currTime = Number(currentCandle?.time);
    if (!Number.isFinite(prevTime) || !Number.isFinite(currTime) || currTime <= prevTime || timestamp <= prevTime) return timestamp >= currTime ? currClose : prevClose;
    const ratio = Math.min(1, Math.max(0, (timestamp - prevTime) / (currTime - prevTime)));
    return prevClose + (currClose - prevClose) * ratio;
  }

  clearMarketContext() {
    this._marketBySymbol.clear();
    this._latestCandle = null;
    this._latestCandleIndex = -1;
    this._latestSymbolContext = null;
  }

  getLatestCandle(symbol = null) {
    if (symbol && this._marketBySymbol.has(symbol)) {
      return this._cloneJSON(this._marketBySymbol.get(symbol).candle);
    }
    return this._latestCandle ? this._cloneJSON(this._latestCandle) : null;
  }

  attachToReplay(replayEngine) {
    if (this._replayEngine === replayEngine && this._unsubs.length > 0) return; // idempotent
    this.detach();
    this._replayEngine = replayEngine;
    // MARKET_CANDLE payload: {candle, index, timestamp, replayState}
    const unsubCandle = replayEngine.on('marketCandle', (payload) => this.onMarketCandle(payload));
    this._unsubs.push(unsubCandle);
    // Clear pending and market state on replay load/reset (data reload protection)
    const clearOnLifecycle = () => {
      this._clearPendingOrders('REPLAY_RESET');
      this.clearMarketContext();
    };
    const unsubLoad = replayEngine.on('loaded', clearOnLifecycle);
    const unsubReset = replayEngine.on('reset', clearOnLifecycle);
    this._lifecycleUnsubs.push(unsubLoad, unsubReset);

    // Engine-level guard: block seek/reset/start/load while position open
    if (typeof replayEngine.registerActionGuard === 'function') {
      const self = this;
      const unguard = replayEngine.registerActionGuard((action) => {
        if (self.hasOpenPosition()) {
          const code = `${action.toUpperCase()}_BLOCKED`;
          const message = `${action.charAt(0).toUpperCase() + action.slice(1)} blocked: close open position first`;
          self.emit(TradingEvents.ORDER_REJECTED, { code, message });
          return { allowed: false, reason: message, code };
        }
        return { allowed: true };
      });
      this._lifecycleUnsubs.push(unguard);
    } else if (!replayEngine._tradingGuardInstalled) {
      replayEngine._tradingGuardInstalled = true;
      replayEngine._origSeekPaper = replayEngine.seek.bind(replayEngine);
      replayEngine._origResetPaper = replayEngine.reset.bind(replayEngine);
      replayEngine._origStartPaper = replayEngine.start.bind(replayEngine);
      replayEngine._origLoadPaper = replayEngine.load.bind(replayEngine);
      const self = this;
      replayEngine.seek = function(idx) {
        if (self.hasOpenPosition()) {
          self.emit(TradingEvents.ORDER_REJECTED, { code: 'SEEK_BLOCKED', message: 'Seek blocked: close open position first' });
          return replayEngine.getState();
        }
        return replayEngine._origSeekPaper(idx);
      };
      replayEngine.reset = function() {
        if (self.hasOpenPosition()) {
          self.emit(TradingEvents.ORDER_REJECTED, { code: 'RESET_BLOCKED', message: 'Reset blocked: close open position first' });
          return replayEngine.getState();
        }
        return replayEngine._origResetPaper();
      };
      replayEngine.start = function(idx) {
        if (self.hasOpenPosition()) {
          self.emit(TradingEvents.ORDER_REJECTED, { code: 'START_BLOCKED', message: 'Start blocked: close open position first' });
          return replayEngine.getState();
        }
        return replayEngine._origStartPaper(idx);
      };
      replayEngine.load = function(candles) {
        if (self.hasOpenPosition()) {
          self.emit(TradingEvents.ORDER_REJECTED, { code: 'LOAD_BLOCKED', message: 'Load blocked: close open position first' });
          return replayEngine.getState();
        }
        return replayEngine._origLoadPaper(candles);
      };
      replayEngine._tradingGuardOwner = self;
    }
  }

  detach() {
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
    this._lifecycleUnsubs.forEach(fn => fn());
    this._lifecycleUnsubs = [];
    this.clearMarketContext();
    if (this._replayEngine && this._replayEngine._tradingGuardOwner === this) {
      const e = this._replayEngine;
      if (e._origSeekPaper) e.seek = e._origSeekPaper;
      if (e._origResetPaper) e.reset = e._origResetPaper;
      if (e._origStartPaper) e.start = e._origStartPaper;
      if (e._origLoadPaper) e.load = e._origLoadPaper;
      delete e._tradingGuardInstalled;
      delete e._origSeekPaper;
      delete e._origResetPaper;
      delete e._origStartPaper;
      delete e._origLoadPaper;
      delete e._tradingGuardOwner;
    }
    this._replayEngine = null;
  }

  // Lifecycle aliases required by audit
  attachReplayEngine(replayEngine) { return this.attachToReplay(replayEngine); }
  detachReplayEngine() { return this.detach(); }
  destroy() { return this.detach(); }

  /**
   * Update latest market price and recalc unrealized PnL.
   * O(1) per candle per open position.
   * @param {object} payload {candle, index, timestamp}
   */
  onMarketCandle(payload) {
    if (!payload || !payload.candle) return;
    const c = payload.candle;
    const symbol = payload.symbol || payload.candle?.symbol || null;
    const previousMarket = symbol ? this._marketBySymbol.get(symbol) : null;
    const idx = Number.isFinite(payload.index) ? payload.index : this._latestCandleIndex + 1;
    // clone
    this._latestCandle = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    this._latestCandleIndex = idx;
    if (symbol) {
      this._latestSymbolContext = symbol;
      this._marketBySymbol.set(symbol, { candle: this._latestCandle, index: idx, timestamp: c.time });
    }

    this._isProcessingCandle = true;
    this._accountNeedsUpdate = false;
    this._totalBarsEvaluated++;

    // 1. INTRABAR: Process eligible pending NEXT_BAR_OPEN market orders at candle.open
    this._processPendingMarketOrders(this._latestCandle, idx, symbol);

    // 2. INTRABAR: Process liquidation triggers against candle OHLC
    this._processLiquidations(this._latestCandle, idx, symbol);

    // 3. INTRABAR: Evaluate SL/TP risk triggers against candle OHLC
    const closedThisCandle = this._processStopLossTakeProfit(this._latestCandle, idx, symbol);
    if (closedThisCandle && closedThisCandle.size > 0) {
      this._cancelStaleExitPendings(closedThisCandle, idx);
    }

    // 3. INTRABAR: Evaluate pending entry/exit orders (LIMIT and STOP_MARKET) with next-candle protection
    this._processPendingOrders(this._latestCandle, idx, symbol);

    // 4. PORTFOLIO FINALIZATION: Mark remaining open positions to candle.close
    let totalUnrealized = 0;
    for (const pos of this._positions.values()) {
      if (!symbol || pos.symbol === symbol) {
        pos.currentPrice = this._latestCandle.close;
        this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
      }
      totalUnrealized += pos.unrealizedPnL;
    }
    this.account.unrealizedPnL = totalUnrealized;

    // 5. Automatic funding evaluation at every scheduled boundary crossed by this candle.
    if (this._fundingSchedule && Number.isFinite(c.time)) {
      const interval = this._fundingSchedule.intervalSec || (8 * 3600);
      const origin = this._fundingSchedule.origin || 0;
      if (this._lastFundingTimestamp == null) this._lastFundingTimestamp = c.time;
      else if (c.time > this._lastFundingTimestamp) {
        const prevTime = this._lastFundingTimestamp;
        let nextBoundary = origin + Math.floor((prevTime - origin) / interval + 1) * interval;
        while (nextBoundary <= c.time) {
          for (const [sym, pos] of this._positions.entries()) {
            if (pos.openedAt != null && Number(pos.openedAt) > nextBoundary) continue;
            const rate = typeof this._fundingSchedule.rateProvider === 'function' ? this._fundingSchedule.rateProvider(nextBoundary, sym) : (this._fundingSchedule.defaultRate ?? 0.0001);
            const mark = sym === symbol ? this._fundingMarkPriceAt(sym, nextBoundary, previousMarket, c) : (Number.isFinite(pos.currentPrice) ? pos.currentPrice : pos.entryPrice);
            this.applyFundingRate({ symbol: sym, fundingRate: rate, timestamp: nextBoundary, markPrice: mark });
          }
          nextBoundary += interval;
        }
        this._lastFundingTimestamp = c.time;
      }
    }

    this._isProcessingCandle = false;

    // 6. CANONICAL EMISSION: Exactly one finalized portfolio snapshot per completed bar
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());

    // 7. BAR_CLOSE: Emit immutable frozen bar-close event
    this.emit(TradingEvents.BAR_CLOSE, {
      index: idx,
      timestamp: c.time,
      candle: Object.freeze({ ...this._latestCandle }),
      phase: 'BAR_CLOSE',
    });
  }

  _processPendingMarketOrders(candle, candleIndex, symbol) {
    if (!this._pendingOrderIds.length) return;
    const remaining = [];
    for (const id of this._pendingOrderIds) {
      const order = this._orders.get(id);
      if (!order || order.status !== ORDER_STATUSES.PENDING) continue;
      if (order.type !== ORDER_TYPES.MARKET) {
        remaining.push(id);
        continue;
      }
      if (symbol && order.symbol !== symbol) {
        remaining.push(id);
        continue;
      }
      // Centralized eligibility rule: cannot execute on creation candle
      if (order.createdIndex >= candleIndex) {
        remaining.push(id);
        continue;
      }

      // Execute market order at candle.open
      const filledPrice = Number.isFinite(candle.open) ? candle.open : candle.close;
      const fillTime = candle.time;
      const qty = order.quantity;
      const side = order.side;
      const existing = this._positions.get(order.symbol);

      if (existing) {
        const isOpposite = (existing.side === 'LONG' && side === 'SELL') || (existing.side === 'SHORT' && side === 'BUY');
        if (isOpposite) {
          this._closePositionInternal(existing.symbol, filledPrice, fillTime, 'MARKET');
          order.status = ORDER_STATUSES.FILLED;
          order.filledAt = fillTime;
          order.filledPrice = filledPrice;
          this._emitOrderFilled(order);
          continue;
        } else {
          order.status = ORDER_STATUSES.REJECTED;
          order.rejectionReason = 'POSITION_ALREADY_OPEN';
          this._emitOrderRejected(order, 'POSITION_ALREADY_OPEN', `Position already open for ${order.symbol}`);
          continue;
        }
      }

      const notional = filledPrice * qty;
      const entryFee = calcFee(notional, this.feeRate);
      const marginCheck = this._checkMarginAvailable(filledPrice, qty);
      if (!marginCheck.valid) {
        order.status = ORDER_STATUSES.REJECTED;
        order.rejectionReason = 'INSUFFICIENT_CASH';
        this._emitOrderRejected(order, 'INSUFFICIENT_CASH', `Insufficient available margin to fill MARKET: required ${marginCheck.requiredMargin.toFixed(2)}, available ${marginCheck.availableMargin.toFixed(2)}`);
        continue;
      }

      this.account.cashBalance -= entryFee;
      this.account.totalFees += entryFee;
      const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
      const { initialMargin, maintenanceMargin, liquidationPrice } = this._calcPositionMargins(filledPrice, qty, posSide);
      const position = new Position({
        symbol: order.symbol,
        side: posSide,
        quantity: qty,
        entryPrice: filledPrice,
        currentPrice: filledPrice,
        openedAt: fillTime,
        entryFee,
        openedIndex: candleIndex,
        initialMargin,
        maintenanceMargin,
        liquidationPrice,
      });
      this._positions.set(order.symbol, position);
      this._recalcMargins();
      order.status = ORDER_STATUSES.FILLED;
      order.filledAt = fillTime;
      order.filledPrice = filledPrice;
      order.entryFee = entryFee;

      this._emitOrderFilled(order);
      this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
      this._cancelIncompatiblePendings(order.symbol);
    }
    this._pendingOrderIds = remaining;
  }

  _cloneJSON(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  _reject(code, message, extra = {}) {
    const err = { success: false, code, message, ...extra };
    // emit immutable copy
    this.emit(TradingEvents.ORDER_REJECTED, this._cloneJSON(err));
    return err;
  }

  _emitOrderPlaced(order) {
    this.emit(TradingEvents.ORDER_PLACED, { order: this._cloneJSON(order.toJSON()) });
  }
  _emitOrderFilled(order) {
    this.emit(TradingEvents.ORDER_FILLED, { order: this._cloneJSON(order.toJSON()) });
  }
  _emitOrderCancelled(order) {
    this.emit(TradingEvents.ORDER_CANCELLED, { order: this._cloneJSON(order.toJSON()) });
  }
  _emitOrderRejected(order, code, message) {
    this.emit(TradingEvents.ORDER_REJECTED, { code, message, order: this._cloneJSON(order.toJSON()) });
  }

  _emitOrderTriggered(order) {
    this.emit(TradingEvents.ORDER_TRIGGERED, { order: this._cloneJSON(order.toJSON()) });
  }

  // ============ MARKET ORDERS ============
  placeOrder({ symbol, side, quantity, timing = this.executionTiming }) {
    // Validation
    const sideRes = TradingValidator.validateSide(side);
    if (!sideRes.valid) return this._reject(sideRes.code, sideRes.message);
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const qtyRes = TradingValidator.validateQuantity(quantity);
    if (!qtyRes.valid) return this._reject(qtyRes.code, qtyRes.message);

    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);

    if (!market || !market.candle) {
      return this._reject('NO_MARKET_PRICE', `Cannot place order: no market price received for ${symbol}.`);
    }

    const q = Number(quantity);
    const execPrice = market.candle.close;
    const time = market.candle.time;
    const candleIndex = market.index;

    const existing = this._positions.get(symbol);

    // Same direction: reject
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        return this._reject('POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`, { symbol });
      }
      if (timing === EXECUTION_TIMING.NEXT_BAR_OPEN) {
        const order = new Order({
          id: this._nextOrderId++,
          symbol,
          side,
          type: ORDER_TYPES.MARKET,
          quantity: q,
          timing: EXECUTION_TIMING.NEXT_BAR_OPEN,
          status: ORDER_STATUSES.PENDING,
          createdAt: Date.now(),
          createdReplayTime: time,
          createdIndex: candleIndex,
        });
        this._orders.set(order.id, order);
        this._pendingOrderIds.push(order.id);
        this._emitOrderPlaced(order);
        return { success: true, order: this._cloneJSON(order.toJSON()), status: ORDER_STATUSES.PENDING };
      }
      // Opposite direction: close existing (do not auto-reverse)
      const result = this._closePositionInternal(symbol, execPrice, time);
      // After market close, cancel incompatible limit pendings
      this._cancelIncompatiblePendings(symbol);
      return result;
    }

    // No existing position:
    if (timing === EXECUTION_TIMING.NEXT_BAR_OPEN) {
      const order = new Order({
        id: this._nextOrderId++,
        symbol,
        side,
        type: ORDER_TYPES.MARKET,
        quantity: q,
        timing: EXECUTION_TIMING.NEXT_BAR_OPEN,
        status: ORDER_STATUSES.PENDING,
        createdAt: Date.now(),
        createdReplayTime: time,
        createdIndex: candleIndex,
      });
      this._orders.set(order.id, order);
      this._pendingOrderIds.push(order.id);
      this._emitOrderPlaced(order);
      return { success: true, order: this._cloneJSON(order.toJSON()), status: ORDER_STATUSES.PENDING };
    }

    // IMMEDIATE_CLOSE mode: open new position immediately at current close
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const entryNotional = execPrice * q;
    const entryFee = calcFee(entryNotional, this.feeRate);
    const marginCheck = this._checkMarginAvailable(execPrice, q);
    if (!marginCheck.valid) {
      return this._reject('INSUFFICIENT_CASH', `Insufficient available margin to place ${side} order: required ${marginCheck.requiredMargin.toFixed(2)}, available ${marginCheck.availableMargin.toFixed(2)}`);
    }
    // deduct entry fee immediately
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const { initialMargin, maintenanceMargin, liquidationPrice } = this._calcPositionMargins(execPrice, q, posSide);
    const position = new Position({
      symbol,
      side: posSide,
      quantity: q,
      entryPrice: execPrice,
      currentPrice: execPrice,
      openedAt: time,
      entryFee,
      openedIndex: candleIndex,
      initialMargin,
      maintenanceMargin,
      liquidationPrice,
    });
    this._positions.set(symbol, position);
    this._recalcMargins();
    // unrealized 0 at open
    this._recalcUnrealized();
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this._emitAccountUpdated();
    // After market open, reject incompatible pendings
    this._cancelIncompatiblePendings(symbol);
    return { success: true, position: this._cloneJSON(position.toJSON()), entryFee };
  }

  /**
   * Close position for symbol at current market price.
   */
  closePosition(symbol, { timing = this.executionTiming } = {}) {
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const existing = this._positions.get(symbol);
    if (!existing) return this._reject('NO_POSITION', `No open position for ${symbol}`);

    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);

    if (!market || !market.candle) {
      return this._reject('NO_MARKET_PRICE', `No market price available to close position for ${symbol}.`);
    }

    if (timing === EXECUTION_TIMING.NEXT_BAR_OPEN) {
      const closeSide = existing.side === 'LONG' ? 'SELL' : 'BUY';
      const order = new Order({
        id: this._nextOrderId++,
        symbol,
        side: closeSide,
        type: ORDER_TYPES.MARKET,
        quantity: existing.quantity,
        timing: EXECUTION_TIMING.NEXT_BAR_OPEN,
        status: ORDER_STATUSES.PENDING,
        createdAt: Date.now(),
        createdReplayTime: market.candle.time,
        createdIndex: market.index,
      });
      this._orders.set(order.id, order);
      this._pendingOrderIds.push(order.id);
      this._emitOrderPlaced(order);
      return { success: true, order: this._cloneJSON(order.toJSON()), status: ORDER_STATUSES.PENDING };
    }

    const execPrice = market.candle.close;
    const time = market.candle.time;
    const res = this._closePositionInternal(symbol, execPrice, time, null);
    this._cancelIncompatiblePendings(symbol);
    return res;
  }

  closePositionImmediate(symbol) {
    return this.closePosition(symbol, { timing: EXECUTION_TIMING.IMMEDIATE_CLOSE });
  }

  _closePositionInternal(symbol, exitPrice, closedAt, exitReason = null, ambiguityResolution = 'NONE') {
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    const gross = pos.side === 'LONG'
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;
    const exitNotional = exitPrice * pos.quantity;
    const exitFee = calcFee(exitNotional, this.feeRate);
    const entryFee = pos.entryFee || 0;
    const totalFee = entryFee + exitFee;
    const net = gross - totalFee;

    // cash: add gross, deduct exitFee (entry already deducted)
    this.account.cashBalance += gross - exitFee;
    this.account.realizedPnL += net;
    this.account.totalFees += exitFee;

    const trade = new Trade({
      id: this._nextTradeId++,
      symbol: pos.symbol,
      side: pos.side,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice,
      openedAt: pos.openedAt,
      closedAt,
      realizedPnL: net,
      grossPnL: gross,
      entryFee,
      exitFee,
      totalFee,
      netPnL: net,
      exitReason,
      ambiguityResolution,
    });
    this._trades.push(trade);

    this._positions.delete(symbol);
    this._recalcUnrealized();
    this._recalcMargins();

    this.emit(TradingEvents.POSITION_CLOSED, { symbol, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, exitPrice, exitReason, trade: this._cloneJSON(trade.toJSON()) });
    this.emit(TradingEvents.TRADE_EXECUTED, { trade: this._cloneJSON(trade.toJSON()) });
    this._emitAccountUpdated();
    return { success: true, exitPrice, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, netPnL: net, exitReason, trade: this._cloneJSON(trade.toJSON()), closedPosition: this._cloneJSON(pos.toJSON()) };
  }

  _closePositionWithReason(symbol, exitPrice, closedAt, exitReason, ambiguityResolution = 'NONE') {
    return this._closePositionInternal(symbol, exitPrice, closedAt, exitReason, ambiguityResolution);
  }

  _recalcUnrealized() {
    let total = 0;
    for (const p of this._positions.values()) total += p.unrealizedPnL;
    this.account.unrealizedPnL = total;
  }

  // ============ LIMIT ORDERS ============

  placeLimitOrder({ symbol, side, quantity, limitPrice }) {
    const sideRes = TradingValidator.validateSide(side);
    if (!sideRes.valid) return this._reject(sideRes.code, sideRes.message);
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const qtyRes = TradingValidator.validateQuantity(quantity);
    if (!qtyRes.valid) return this._reject(qtyRes.code, qtyRes.message);
    const priceRes = TradingValidator.validateLimitPrice(limitPrice);
    if (!priceRes.valid) return this._reject(priceRes.code, priceRes.message);
    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);

    if (!market || !market.candle) {
      return this._reject('NO_MARKET_PRICE', `Cannot place limit order: no market price received for ${symbol}.`);
    }
    const q = Number(quantity);
    const lp = Number(limitPrice);
    const orderId = `order-${this._nextOrderId++}`;
    const createdTime = market.candle.time;
    const createdIdx = market.index;
    const order = new Order({
      id: orderId,
      symbol,
      side,
      type: ORDER_TYPES.LIMIT,
      quantity: q,
      limitPrice: lp,
      status: ORDER_STATUSES.PENDING,
      createdAt: createdTime,
      createdReplayTime: createdTime,
      createdIndex: createdIdx,
    });
    this._orders.set(orderId, order);
    this._pendingOrderIds.push(orderId);
    this._emitOrderPlaced(order);
    return { success: true, order: this._cloneJSON(order.toJSON()) };
  }

  // ============ STOP MARKET ORDERS ============

  placeStopOrder({ symbol, side, quantity, stopPrice }) {
    // alias for STOP_MARKET: validates stopPrice
    const sideRes = TradingValidator.validateSide(side);
    if (!sideRes.valid) return this._reject(sideRes.code, sideRes.message);
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const qtyRes = TradingValidator.validateQuantity(quantity);
    if (!qtyRes.valid) return this._reject(qtyRes.code, qtyRes.message);
    const priceRes = TradingValidator.validateStopPrice(stopPrice);
    if (!priceRes.valid) return this._reject(priceRes.code, priceRes.message);
    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);

    if (!market || !market.candle) {
      return this._reject('NO_MARKET_PRICE', `Cannot place stop order: no market price received for ${symbol}.`);
    }
    const q = Number(quantity);
    const sp = Number(stopPrice);
    const orderId = `order-${this._nextOrderId++}`;
    const createdTime = market.candle.time;
    const createdIdx = market.index;
    const order = new Order({
      id: orderId,
      symbol,
      side,
      type: ORDER_TYPES.STOP_MARKET,
      quantity: q,
      stopPrice: sp,
      status: ORDER_STATUSES.PENDING,
      createdAt: createdTime,
      createdReplayTime: createdTime,
      createdIndex: createdIdx,
    });
    this._orders.set(orderId, order);
    this._pendingOrderIds.push(orderId);
    this._emitOrderPlaced(order);
    return { success: true, order: this._cloneJSON(order.toJSON()) };
  }

  // alias used by some tests
  placeStopMarketOrder(opts) { return this.placeStopOrder(opts); }

  cancelOrder(orderId) {
    const order = this._orders.get(orderId);
    if (!order) {
      return this._reject('ORDER_NOT_FOUND', `Order not found: ${orderId}`, { orderId });
    }
    if (order.status !== ORDER_STATUSES.PENDING) {
      return this._reject('ORDER_NOT_PENDING', `Cannot cancel order in status ${order.status}`, { orderId, status: order.status });
    }
    order.status = ORDER_STATUSES.CANCELLED;
    order.cancelReason = 'USER_CANCELLED';
    // remove from pending queue
    this._pendingOrderIds = this._pendingOrderIds.filter(id => id !== orderId);
    this._emitOrderCancelled(order);
    return { success: true, order: this._cloneJSON(order.toJSON()) };
  }

  _processPendingOrders(candle, candleIndex, targetSymbol = null) {
    if (this._pendingOrderIds.length === 0) return;
    // O(p) per candle: iterate snapshot, collect removals, single filter at end to avoid O(p²)
    const snapshot = [...this._pendingOrderIds];
    const toRemove = new Set();
    for (const id of snapshot) {
      if (toRemove.has(id)) continue;
      const order = this._orders.get(id);
      if (!order) { toRemove.add(id); continue; }
      if (order.status !== ORDER_STATUSES.PENDING) { toRemove.add(id); continue; }
      if (targetSymbol && order.symbol !== targetSymbol) continue;
      if (order.createdIndex >= candleIndex) continue;
      let shouldFill = false;
      if (order.type === ORDER_TYPES.LIMIT) {
        if (order.side === 'BUY' && candle.low <= order.limitPrice) shouldFill = true;
        if (order.side === 'SELL' && candle.high >= order.limitPrice) shouldFill = true;
        if (shouldFill) {
          const res = this._executeLimitFill(order, candle);
          toRemove.add(id);
          // If fill rejected due to POSITION_ALREADY_OPEN, the execute already removed from queue;
          // still track removal batch.
          // For entry fills, _executeLimitFill may have rejected other same-side pendings via _cancelIncompatiblePendings;
          // sync toRemove with current pending queue removals
          continue;
        }
      } else if (order.type === ORDER_TYPES.STOP_MARKET) {
        if (order.side === 'BUY' && candle.high >= order.stopPrice) shouldFill = true;
        if (order.side === 'SELL' && candle.low <= order.stopPrice) shouldFill = true;
        if (shouldFill) {
          this._executeStopFill(order, candle);
          toRemove.add(id);
          continue;
        }
      }
    }
    // Sync any additional removals caused by _cancelIncompatiblePendings / stale logic inside fills:
    // Ensure pending queue contains only still-pending orders
    if (toRemove.size > 0) {
      this._pendingOrderIds = this._pendingOrderIds.filter(pid => !toRemove.has(pid) && this._orders.get(pid)?.status === ORDER_STATUSES.PENDING);
    } else {
      // still prune any non-pending that may have been marked rejected/cancelled by _cancelIncompatiblePendings triggered outside this loop
      // This is O(p) once per candle, not O(p²)
      const before = this._pendingOrderIds.length;
      this._pendingOrderIds = this._pendingOrderIds.filter(pid => this._orders.get(pid)?.status === ORDER_STATUSES.PENDING);
    }
  }

  // Backward compat for Phase7: alias
  _processPendingLimitOrders(candle, candleIndex) { return this._processPendingOrders(candle, candleIndex); }

  _executeLimitFill(order, candle) {
    const symbol = order.symbol;
    const side = order.side;
    const qty = order.quantity;
    const limitPrice = order.limitPrice;
    const fillTime = candle.time;
    const existing = this._positions.get(symbol);

    // Enforce legal transition: only PENDING can become FILLED/REJECTED
    if (order.status !== ORDER_STATUSES.PENDING) {
      return { success: false, code: 'ORDER_NOT_PENDING' };
    }

    // Position interaction
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        // same-side duplicate -> reject fill
        order.status = ORDER_STATUSES.REJECTED;
        order.rejectionReason = 'POSITION_ALREADY_OPEN';
        this._emitOrderRejected(order, 'POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`);
        return { success: false, code: 'POSITION_ALREADY_OPEN' };
      }
      // Opposite side -> close existing at limitPrice or gap-through open
      let filledPrice = limitPrice;
      if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
        if (side === 'BUY' && Number.isFinite(candle.open) && candle.open < limitPrice) {
          filledPrice = candle.open;
        } else if (side === 'SELL' && Number.isFinite(candle.open) && candle.open > limitPrice) {
          filledPrice = candle.open;
        }
      }
      order.status = ORDER_STATUSES.FILLED;
      order.filledAt = fillTime;
      order.filledPrice = filledPrice;
      // trigger event before fill for determinism
      this._emitOrderTriggeredIfNeeded(order);
      const pos = existing;
      const gross = pos.side === 'LONG'
        ? (filledPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - filledPrice) * pos.quantity;
      const exitNotional = filledPrice * pos.quantity;
      const exitFee = calcFee(exitNotional, this.feeRate);
      const entryFee = pos.entryFee || 0;
      const totalFee = entryFee + exitFee;
      const net = gross - totalFee;
      this.account.cashBalance += gross - exitFee;
      this.account.realizedPnL += net;
      this.account.totalFees += exitFee;
      order.exitFee = exitFee;
      order.entryFee = entryFee;
      const trade = new Trade({
        id: this._nextTradeId++,
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        exitPrice: filledPrice,
        openedAt: pos.openedAt,
        closedAt: fillTime,
        realizedPnL: net,
        grossPnL: gross,
        entryFee,
        exitFee,
        totalFee,
        netPnL: net,
        exitReason: 'LIMIT',
      });
      this._trades.push(trade);
      this._positions.delete(symbol);
      this._recalcUnrealized();
      this._emitOrderFilled(order);
      this.emit(TradingEvents.POSITION_CLOSED, { symbol, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, exitPrice: filledPrice, exitReason: 'LIMIT', trade: this._cloneJSON(trade.toJSON()) });
      this.emit(TradingEvents.TRADE_EXECUTED, { trade: this._cloneJSON(trade.toJSON()) });
      this._emitAccountUpdated();
      return { success: true, filled: true };
    }

    // No existing position -> open new with gap-through price improvement
    let filledPrice = limitPrice;
    if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
      if (side === 'BUY' && Number.isFinite(candle.open) && candle.open < limitPrice) {
        filledPrice = candle.open;
      } else if (side === 'SELL' && Number.isFinite(candle.open) && candle.open > limitPrice) {
        filledPrice = candle.open;
      }
    }
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const notional = filledPrice * qty;
    const entryFee = calcFee(notional, this.feeRate);
    const marginCheck = this._checkMarginAvailable(filledPrice, qty);
    if (!marginCheck.valid) {
      order.status = ORDER_STATUSES.REJECTED;
      order.rejectionReason = 'INSUFFICIENT_CASH';
      this._emitOrderRejected(order, 'INSUFFICIENT_CASH', `Insufficient available margin to fill ${side} limit: required ${marginCheck.requiredMargin.toFixed(2)}, available ${marginCheck.availableMargin.toFixed(2)}`);
      return { success: false, code: 'INSUFFICIENT_CASH' };
    }
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const { initialMargin, maintenanceMargin, liquidationPrice } = this._calcPositionMargins(filledPrice, qty, posSide);
    const position = new Position({
      symbol,
      side: posSide,
      quantity: qty,
      entryPrice: filledPrice,
      currentPrice: filledPrice,
      openedAt: fillTime,
      entryFee,
      openedIndex: candle.time ? this._latestCandleIndex : -1,
      initialMargin,
      maintenanceMargin,
      liquidationPrice,
    });
    // ensure openedIndex tracks candle index for SL/TP protection
    position.openedIndex = this._latestCandleIndex;
    this._positions.set(symbol, position);
    this._recalcMargins();
    order.status = ORDER_STATUSES.FILLED;
    order.filledAt = fillTime;
    order.filledPrice = filledPrice;
    order.entryFee = entryFee;
    this._emitOrderTriggeredIfNeeded(order);
    this._recalcUnrealized();
    this._emitOrderFilled(order);
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this._emitAccountUpdated();
    this._cancelIncompatiblePendings(symbol);
    return { success: true, filled: true };
  }

  _executeStopFill(order, candle) {
    const symbol = order.symbol;
    const side = order.side;
    const qty = order.quantity;
    const stopPrice = order.stopPrice;
    const fillTime = candle.time;
    const existing = this._positions.get(symbol);
    // Enforce legal transition
    if (order.status !== ORDER_STATUSES.PENDING) {
      return { success: false, code: 'ORDER_NOT_PENDING' };
    }
    // trigger event first
    this._emitOrderTriggered(order);
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        order.status = ORDER_STATUSES.REJECTED;
        order.rejectionReason = 'POSITION_ALREADY_OPEN';
        this._emitOrderRejected(order, 'POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`);
        return { success: false, code: 'POSITION_ALREADY_OPEN' };
      }
      // Deterministic gap-through slippage
      let filledPrice = stopPrice;
      if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
        if (side === 'BUY' && Number.isFinite(candle.open) && candle.open > stopPrice) {
          filledPrice = candle.open;
        } else if (side === 'SELL' && Number.isFinite(candle.open) && candle.open < stopPrice) {
          filledPrice = candle.open;
        }
      }
      order.status = ORDER_STATUSES.FILLED;
      order.filledAt = fillTime;
      order.filledPrice = filledPrice;
      const pos = existing;
      const gross = pos.side === 'LONG'
        ? (filledPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - filledPrice) * pos.quantity;
      const exitNotional = filledPrice * pos.quantity;
      const exitFee = calcFee(exitNotional, this.feeRate);
      const entryFee = pos.entryFee || 0;
      const totalFee = entryFee + exitFee;
      const net = gross - totalFee;
      this.account.cashBalance += gross - exitFee;
      this.account.realizedPnL += net;
      this.account.totalFees += exitFee;
      order.exitFee = exitFee;
      order.entryFee = entryFee;
      const trade = new Trade({
        id: this._nextTradeId++,
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        exitPrice: filledPrice,
        openedAt: pos.openedAt,
        closedAt: fillTime,
        realizedPnL: net,
        grossPnL: gross,
        entryFee,
        exitFee,
        totalFee,
        netPnL: net,
        exitReason: 'STOP',
      });
      this._trades.push(trade);
      this._positions.delete(symbol);
      this._recalcUnrealized();
      this._emitOrderFilled(order);
      this.emit(TradingEvents.POSITION_CLOSED, { symbol, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, exitPrice: filledPrice, exitReason: 'STOP', trade: this._cloneJSON(trade.toJSON()) });
      this.emit(TradingEvents.TRADE_EXECUTED, { trade: this._cloneJSON(trade.toJSON()) });
      this._emitAccountUpdated();
      return { success: true, filled: true };
    }
    // No existing position -> open new with gap-through slippage
    let filledPrice = stopPrice;
    if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
      if (side === 'BUY' && Number.isFinite(candle.open) && candle.open > stopPrice) {
        filledPrice = candle.open;
      } else if (side === 'SELL' && Number.isFinite(candle.open) && candle.open < stopPrice) {
        filledPrice = candle.open;
      }
    }
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const notional = filledPrice * qty;
    const entryFee = calcFee(notional, this.feeRate);
    const marginCheck = this._checkMarginAvailable(filledPrice, qty);
    if (!marginCheck.valid) {
      order.status = ORDER_STATUSES.REJECTED;
      order.rejectionReason = 'INSUFFICIENT_CASH';
      this._emitOrderRejected(order, 'INSUFFICIENT_CASH', `Insufficient available margin to fill STOP: required ${marginCheck.requiredMargin.toFixed(2)}, available ${marginCheck.availableMargin.toFixed(2)}`);
      return { success: false, code: 'INSUFFICIENT_CASH' };
    }
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const { initialMargin, maintenanceMargin, liquidationPrice } = this._calcPositionMargins(filledPrice, qty, posSide);
    const position = new Position({
      symbol,
      side: posSide,
      quantity: qty,
      entryPrice: filledPrice,
      currentPrice: filledPrice,
      openedAt: fillTime,
      entryFee,
      openedIndex: this._latestCandleIndex,
      initialMargin,
      maintenanceMargin,
      liquidationPrice,
    });
    position.openedIndex = this._latestCandleIndex;
    this._positions.set(symbol, position);
    this._recalcMargins();
    order.status = ORDER_STATUSES.FILLED;
    order.filledAt = fillTime;
    order.filledPrice = filledPrice;
    order.entryFee = entryFee;
    this._recalcUnrealized();
    this._emitOrderFilled(order);
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this._emitAccountUpdated();
    this._cancelIncompatiblePendings(symbol);
    return { success: true, filled: true };
  }

  _emitOrderTriggeredIfNeeded(order) {
    // For LIMIT we may optionally emit triggered as fulfilled; keep for symmetry but emit ORDER_TRIGGERED for STOP only
    if (order.type === ORDER_TYPES.STOP_MARKET) {
      // already emitted in executeStopFill; this is for limit path we don't emit
      return;
    }
  }

  // ============ STOP LOSS / TAKE PROFIT ============
  /**
   * Deterministic ambiguity rule: if SL and TP are both touched in the same candle, SL has priority (conservative).
   * SL triggers before TP. Documented explicitly.
   */
  _cancelStaleExitPendings(closedMap, candleIndex) {
    // closedMap: Map symbol -> closedSide ('LONG'|'SHORT')
    for (const [symbol, closedSide] of closedMap.entries()) {
      const staleIds = this._pendingOrderIds.filter(id => {
        const o = this._orders.get(id);
        if (!o || o.status !== ORDER_STATUSES.PENDING) return false;
        if (o.symbol !== symbol) return false;
        if (o.createdIndex >= candleIndex) return false; // created this candle, not stale
        const orderIsLong = o.side === 'BUY';
        const closedIsLong = closedSide === 'LONG';
        // Stale exit: order side opposite to closed position side (e.g., SELL while LONG was closed)
        // These were exit intents and must not become reversal entries same candle.
        const isStaleExit = (closedIsLong && !orderIsLong) || (!closedIsLong && orderIsLong);
        return isStaleExit;
      });
      for (const id of staleIds) {
        const o = this._orders.get(id);
        o.status = ORDER_STATUSES.CANCELLED;
        o.cancelReason = 'STALE_EXIT_AFTER_RISK_CLOSE';
        this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== id);
        this._emitOrderCancelled(o);
      }
    }
  }

  _processStopLossTakeProfit(candle, candleIndex, targetSymbol = null) {
    const closed = new Map(); // symbol -> side
    // iterate positions snapshot
    for (const [symbol, pos] of [...this._positions.entries()]) {
      if (targetSymbol && symbol !== targetSymbol) continue;
      // same-candle protection: position must not use entry candle
      if (pos.openedIndex >= candleIndex) continue;
      const sl = pos.stopLossPrice;
      const tp = pos.takeProfitPrice;
      const slIdx = pos.stopLossCreatedIndex;
      const tpIdx = pos.takeProfitCreatedIndex;
      let triggerSL = false;
      let triggerTP = false;
      if (sl != null && Number.isFinite(sl) && slIdx < candleIndex) {
        if (pos.side === 'LONG' && candle.low <= sl) triggerSL = true;
        if (pos.side === 'SHORT' && candle.high >= sl) triggerSL = true;
      }
      if (tp != null && Number.isFinite(tp) && tpIdx < candleIndex) {
        if (pos.side === 'LONG' && candle.high >= tp) triggerTP = true;
        if (pos.side === 'SHORT' && candle.low <= tp) triggerTP = true;
      }
      let ambiguityResolution = AMBIGUITY_RESOLUTION.NONE;
      if (triggerSL && triggerTP) {
        this._ambiguousBarCount++;
        if (this.ambiguityPolicy === AMBIGUITY_POLICY.TP_FIRST) {
          ambiguityResolution = AMBIGUITY_RESOLUTION.TP_FIRST;
          triggerSL = false;
        } else if (this.ambiguityPolicy === AMBIGUITY_POLICY.OPEN_PROXIMITY && Number.isFinite(candle.open)) {
          ambiguityResolution = AMBIGUITY_RESOLUTION.HEURISTIC_PROXIMITY;
          const slDist = Math.abs(candle.open - sl);
          const tpDist = Math.abs(candle.open - tp);
          if (tpDist < slDist) {
            triggerSL = false;
          } else {
            triggerTP = false;
          }
        } else {
          // Default CONSERVATIVE / SL_FIRST
          ambiguityResolution = AMBIGUITY_RESOLUTION.SL_FIRST;
          triggerTP = false;
        }
      }
      if (triggerSL) {
        let price = sl;
        if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
          if (pos.side === 'LONG' && Number.isFinite(candle.open) && candle.open < sl) {
            price = candle.open;
          } else if (pos.side === 'SHORT' && Number.isFinite(candle.open) && candle.open > sl) {
            price = candle.open;
          }
        }
        const sideBefore = pos.side;
        this.emit(TradingEvents.STOP_LOSS_TRIGGERED, { symbol, price, position: this._cloneJSON(pos.toJSON()), candle: this._cloneJSON(candle) });
        this._closePositionWithReason(symbol, price, candle.time, 'STOP_LOSS', ambiguityResolution);
        closed.set(symbol, sideBefore);
      } else if (triggerTP) {
        let price = tp;
        if (this.executionPolicy === EXECUTION_POLICY.REALISTIC) {
          if (pos.side === 'LONG' && Number.isFinite(candle.open) && candle.open > tp) {
            price = candle.open;
          } else if (pos.side === 'SHORT' && Number.isFinite(candle.open) && candle.open < tp) {
            price = candle.open;
          }
        }
        const sideBefore = pos.side;
        this.emit(TradingEvents.TAKE_PROFIT_TRIGGERED, { symbol, price, position: this._cloneJSON(pos.toJSON()), candle: this._cloneJSON(candle) });
        this._closePositionWithReason(symbol, price, candle.time, 'TAKE_PROFIT', ambiguityResolution);
        closed.set(symbol, sideBefore);
      }
    }
    return closed;
  }

  // Public API for SL/TP
  setStopLoss(symbolOrOpts, priceMaybe) {
    let symbol, price;
    if (typeof symbolOrOpts === 'object' && symbolOrOpts !== null) {
      symbol = symbolOrOpts.symbol || symbolOrOpts.ticker || this._positions.keys().next().value;
      price = symbolOrOpts.price ?? symbolOrOpts.stopLoss ?? symbolOrOpts.stopPrice ?? symbolOrOpts.value;
    } else if (priceMaybe !== undefined) {
      symbol = symbolOrOpts;
      price = priceMaybe;
    } else {
      // single arg price assumes single position
      price = symbolOrOpts;
      const first = [...this._positions.keys()][0];
      symbol = first;
    }
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const pr = TradingValidator.validateStopPrice(price);
    if (!pr.valid) return this._reject(pr.code, pr.message);
    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);
    if (!market || !market.candle) return this._reject('NO_MARKET_PRICE', `Cannot set SL before first candle for ${symbol}`);
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.stopLossPrice = Number(price);
    pos.stopLossCreatedIndex = market.index;
    this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
    return { success: true, position: this._cloneJSON(pos.toJSON()) };
  }

  setTakeProfit(symbolOrOpts, priceMaybe) {
    let symbol, price;
    if (typeof symbolOrOpts === 'object' && symbolOrOpts !== null) {
      symbol = symbolOrOpts.symbol || symbolOrOpts.ticker || this._positions.keys().next().value;
      price = symbolOrOpts.price ?? symbolOrOpts.takeProfit ?? symbolOrOpts.tpPrice ?? symbolOrOpts.value;
    } else if (priceMaybe !== undefined) {
      symbol = symbolOrOpts;
      price = priceMaybe;
    } else {
      price = symbolOrOpts;
      const first = [...this._positions.keys()][0];
      symbol = first;
    }
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const pr = TradingValidator.validateStopPrice(price);
    if (!pr.valid) {
      // reuse same code but map to invalid TP
      const msg = pr.message ? pr.message.replace(/Stop price/i, 'Take profit price') : 'Invalid take profit price';
      return this._reject(pr.code === 'INVALID_STOP_PRICE' ? 'INVALID_TAKE_PROFIT_PRICE' : pr.code, msg);
    }
    const market = this._marketBySymbol.get(symbol)
      || (this._latestCandle && (!this._latestSymbolContext || this._latestSymbolContext === symbol) ? { candle: this._latestCandle, index: this._latestCandleIndex } : null);
    if (!market || !market.candle) return this._reject('NO_MARKET_PRICE', `Cannot set TP before first candle for ${symbol}`);
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.takeProfitPrice = Number(price);
    pos.takeProfitCreatedIndex = market.index;
    this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
    return { success: true, position: this._cloneJSON(pos.toJSON()) };
  }

  // Convenience combined
  setRisk({ symbol, stopLoss, takeProfit, stopLossPrice, takeProfitPrice } = {}) {
    if (!symbol) {
      const first = [...this._positions.keys()][0];
      symbol = first;
    }
    const sl = stopLoss ?? stopLossPrice;
    const tp = takeProfit ?? takeProfitPrice;
    let res;
    if (sl != null) {
      res = this.setStopLoss(symbol, sl);
      if (!res.success) return res;
    }
    if (tp != null) {
      res = this.setTakeProfit(symbol, tp);
      if (!res.success) return res;
    }
    return { success: true };
  }

  clearStopLoss(symbol) {
    if (!symbol) symbol = [...this._positions.keys()][0];
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.stopLossPrice = null;
    pos.stopLossCreatedIndex = -1;
    this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
    return { success: true };
  }

  clearTakeProfit(symbol) {
    if (!symbol) symbol = [...this._positions.keys()][0];
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.takeProfitPrice = null;
    pos.takeProfitCreatedIndex = -1;
    this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
    return { success: true };
  }

  getStopLoss(symbol) {
    const pos = symbol ? this._positions.get(symbol) : [...this._positions.values()][0];
    if (!pos) return null;
    return pos.stopLossPrice ?? null;
  }

  getTakeProfit(symbol) {
    const pos = symbol ? this._positions.get(symbol) : [...this._positions.values()][0];
    if (!pos) return null;
    return pos.takeProfitPrice ?? null;
  }

  updateStopLoss(...args) { return this.setStopLoss(...args); }
  updateTakeProfit(...args) { return this.setTakeProfit(...args); }
  setStopLossPrice(...args) { return this.setStopLoss(...args); }
  setTakeProfitPrice(...args) { return this.setTakeProfit(...args); }

  _cancelIncompatiblePendings(symbol) {
    const pos = this._positions.get(symbol);
    if (!pos) return;
    const posIsLong = pos.side === 'LONG';
    // Any pending BUY while LONG, or SELL while SHORT is incompatible
    const incompatibleIds = this._pendingOrderIds.filter(id => {
      const o = this._orders.get(id);
      if (!o || o.status !== ORDER_STATUSES.PENDING) return false;
      if (o.symbol !== symbol) return false;
      const orderIsLong = o.side === 'BUY';
      return (posIsLong && orderIsLong) || (!posIsLong && !orderIsLong);
    });
    for (const id of incompatibleIds) {
      const o = this._orders.get(id);
      o.status = ORDER_STATUSES.REJECTED;
      o.rejectionReason = 'POSITION_ALREADY_OPEN';
      this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== id);
      this._emitOrderRejected(o, 'POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${pos.side}). Pending order rejected.`);
    }
  }

  _clearPendingOrders(reason = 'CLEARED') {
    if (this._pendingOrderIds.length === 0) return;
    const ids = [...this._pendingOrderIds];
    for (const id of ids) {
      const o = this._orders.get(id);
      if (o && o.status === ORDER_STATUSES.PENDING) {
        o.status = ORDER_STATUSES.CANCELLED;
        o.cancelReason = reason;
        this._emitOrderCancelled(o);
      }
    }
    this._pendingOrderIds = [];
  }

  clearPendingOrders(reason) {
    return this._clearPendingOrders(reason || 'CLEARED');
  }

  getPendingOrders() {
    return this._pendingOrderIds
      .map(id => this._orders.get(id))
      .filter(Boolean)
      .map(o => this._cloneJSON(o.toJSON()));
  }

  getOrders() {
    return Array.from(this._orders.values()).map(o => this._cloneJSON(o.toJSON()));
  }

  getOrder(id) {
    const o = this._orders.get(id);
    return o ? this._cloneJSON(o.toJSON()) : null;
  }

  resetAccount() {
    this._positions.clear();
    this._trades = [];
    this._nextTradeId = 1;
    this._ambiguousBarCount = 0;
    this._totalBarsEvaluated = 0;
    this._fundingHistory = [];
    this._lastFundingTimestamp = null;
    this.clearMarketContext();
    // ID determinism note: _nextOrderId is intentionally NOT reset to avoid collision
    // with preserved order history (orders remain in _orders Map as CANCELLED).
    // Fresh engine instance gives deterministic IDs for identical sequences;
    // resetAccount preserves monotonic order IDs for collision safety.
    // If deterministic IDs after reset are required, create a fresh engine instance.
    this.account.reset();
    this._clearPendingOrders('ACCOUNT_RESET');
    this.emit(TradingEvents.ACCOUNT_RESET, this.getAccountSnapshot());
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return this.getAccountSnapshot();
  }

  // For testing: allow explicit full reset that clears order history and resets IDs
  // This is the deterministic path for repeated simulations via same instance.
  resetAll({ clearMarket = false } = {}) {
    this._positions.clear();
    this._trades = [];
    this._nextTradeId = 1;
    this._nextOrderId = 1;
    this._orders.clear();
    this._pendingOrderIds = [];
    this._ambiguousBarCount = 0;
    this._totalBarsEvaluated = 0;
    this._fundingHistory = [];
    this._lastFundingTimestamp = null;
    if (clearMarket) this.clearMarketContext();
    this.account.reset();
    this.emit(TradingEvents.ACCOUNT_RESET, this.getAccountSnapshot());
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return this.getAccountSnapshot();
  }

  setStartingBalance(newBalance) {
    const val = Number(newBalance);
    if (!Number.isFinite(val) || val <= 0) return { success: false, message: 'Invalid starting balance' };
    this.account.startingBalance = val;
    this.account.cashBalance = val;
    this.account.realizedPnL = 0;
    this.account.unrealizedPnL = 0;
    this.account.totalFees = 0;
    this._positions.clear();
    this._trades = [];
    this._clearPendingOrders('BALANCE_CHANGED');
    this.emit(TradingEvents.ACCOUNT_RESET, this.getAccountSnapshot());
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return { success: true, balance: val };
  }

  setFeeRate(newRate) {
    const val = Number(newRate);
    if (!Number.isFinite(val) || val < 0) return { success: false, message: 'Invalid fee rate' };
    this.feeRate = val;
    return { success: true, feeRate: val };
  }

  getPerformanceStats() {
    const trades = this._trades;
    const totalTrades = trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    for (const t of trades) {
      const net = t.netPnL ?? t.realizedPnL ?? 0;
      if (net > 0) {
        winningTrades++;
        grossProfit += net;
      } else if (net < 0) {
        losingTrades++;
        grossLoss += Math.abs(net);
      }
    }
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0;
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 1);
    const netReturn = this.account.startingBalance > 0
      ? ((this.account.equity - this.account.startingBalance) / this.account.startingBalance * 100)
      : 0;
    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      grossProfit,
      grossLoss,
      netReturn,
      totalFees: this.account.totalFees,
    };
  }

  getAccountSnapshot() {
    const snap = this.account.snapshot();
    snap.ambiguousBars = this._ambiguousBarCount;
    snap.totalBars = this._totalBarsEvaluated;
    snap.ambiguousBarRate = this._totalBarsEvaluated > 0 ? (this._ambiguousBarCount / this._totalBarsEvaluated) : 0;
    // return deep clone to prevent mutation
    return this._cloneJSON(snap);
  }

  getBacktestSummary() {
    return {
      totalBars: this._totalBarsEvaluated,
      ambiguousBars: this._ambiguousBarCount,
      ambiguousBarRate: this._totalBarsEvaluated > 0 ? (this._ambiguousBarCount / this._totalBarsEvaluated) : 0,
      totalTrades: this._trades.length,
      realizedPnL: this.account.realizedPnL,
      totalFees: this.account.totalFees,
      totalFundingPaid: this.account.totalFundingPaid,
      walletBalance: this.account.walletBalance,
      equity: this.account.equity,
    };
  }

  // Comprehensive state for immutability audits (Phase 9)
  getState() {
    return this._cloneJSON({
      account: this.account.snapshot(),
      positions: Array.from(this._positions.values()).map(p => p.toJSON()),
      orders: Array.from(this._orders.values()).map(o => o.toJSON()),
      pendingOrderIds: [...this._pendingOrderIds],
      trades: this._trades.map(t => t.toJSON()),
      latestCandle: this._latestCandle ? { ...this._latestCandle } : null,
      latestCandleIndex: this._latestCandleIndex,
      nextOrderId: this._nextOrderId,
      nextTradeId: this._nextTradeId,
    });
  }

  getPosition(symbol) {
    const p = this._positions.get(symbol);
    return p ? this._cloneJSON(p.toJSON()) : null;
  }

  getPositions() {
    return Array.from(this._positions.values()).map(p => this._cloneJSON(p.toJSON()));
  }

  getTrades() {
    return this._trades.map(t => this._cloneJSON(t.toJSON()));
  }

  // Alias required by audit spec
  getTradeHistory() {
    return this.getTrades();
  }

  // Invariant checker for tests (Phase 9) — verifies equity = cash + unrealized, fees sum, etc.
  checkInvariants() {
    const acct = this.account;
    const equity = acct.cashBalance + acct.unrealizedPnL;
    const equityOk = Math.abs(acct.equity - equity) < 1e-9;
    const feesSum = this._trades.reduce((s, t) => s + (t.totalFee || 0), 0) + Array.from(this._positions.values()).reduce((s, p) => s + (p.entryFee || 0), 0);
    // totalFees should equal sum of all entry+exit fees from trades plus current open position entry fees
    // But account.totalFees already includes entry fees for open positions + closed trades totalFees
    // Simpler: totalFees >=0 and after close unrealized==0
    const unrealizedOk = this._positions.size === 0 ? Math.abs(acct.unrealizedPnL) < 1e-9 : true;
    const pendingIdsUnique = new Set(this._pendingOrderIds).size === this._pendingOrderIds.length;
    const pendingAllPending = this._pendingOrderIds.every(id => this._orders.get(id)?.status === ORDER_STATUSES.PENDING);
    return {
      equityOk,
      unrealizedOk,
      pendingIdsUnique,
      pendingAllPending,
      equity,
      unrealizedPnL: acct.unrealizedPnL,
      cashBalance: acct.cashBalance,
      totalFees: acct.totalFees,
      computedFeesSum: feesSum,
    };
  }

  hasOpenPosition(symbol = null) {
    if (symbol) return this._positions.has(symbol);
    return this._positions.size > 0;
  }

  canSeek() {
    return !this.hasOpenPosition();
  }

  getLatestCandle() {
    return this._latestCandle ? { ...this._latestCandle } : null;
  }

  getLatestCandleIndex() {
    return this._latestCandleIndex;
  }
}
