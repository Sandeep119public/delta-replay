import { EventEmitter } from '../core/EventEmitter.js';
import { TradingAccount } from './TradingAccount.js';
import { Position } from './Position.js';
import { Trade } from './Trade.js';
import { TradingEvents } from './TradingEvents.js';
import { TradingValidator } from './TradingValidator.js';
import { TRADING_CONFIG, calcFee } from './TradingConfig.js';
import { Order, ORDER_TYPES, ORDER_STATUSES } from './Order.js';

/**
 * PaperTradingEngine — consumes MARKET_CANDLE only.
 * Never touches AppState.candles, ReplayEngine._candles, Chart data, Timeline.
 *
 * Deterministic: market execution = close, limit execution = limitPrice with next-candle rule.
 * One position per symbol.
 */
export class PaperTradingEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} [opts.startingBalance=10000]
   * @param {number} [opts.feeRate] - taker fee rate, defaults to TRADING_CONFIG
   * @param {import('../replay/ReplayEngine.js').ReplayEngine} [opts.replayEngine] - optional auto-wire
   */
  constructor({ startingBalance = 10000, feeRate = TRADING_CONFIG.TAKER_FEE_RATE, replayEngine = null } = {}) {
    super();
    this.account = new TradingAccount({ startingBalance });
    this.feeRate = feeRate;
    this._positions = new Map(); // symbol -> Position
    this._trades = [];
    this._nextTradeId = 1;
    this._latestCandle = null; // cloned
    this._latestCandleIndex = -1;
    this._latestSymbolContext = null;
    this._replayEngine = null;
    this._unsubs = [];
    // limit orders
    this._orders = new Map(); // id -> Order instance (raw)
    this._pendingOrderIds = []; // ordered queue of pending ids
    this._nextOrderId = 1;
    this._lifecycleUnsubs = [];
    if (replayEngine) this.attachToReplay(replayEngine);
  }

  attachToReplay(replayEngine) {
    if (this._replayEngine === replayEngine && this._unsubs.length > 0) return; // idempotent
    this.detach();
    this._replayEngine = replayEngine;
    // MARKET_CANDLE payload: {candle, index, timestamp, replayState}
    const unsubCandle = replayEngine.on('marketCandle', (payload) => this.onMarketCandle(payload));
    this._unsubs.push(unsubCandle);
    // Clear pending on replay load/reset (data reload protection) — stored separately to preserve audit _unsubs length=1
    const clearOnLifecycle = () => this._clearPendingOrders('REPLAY_RESET');
    const unsubLoad = replayEngine.on('loaded', clearOnLifecycle);
    const unsubReset = replayEngine.on('reset', clearOnLifecycle);
    this._lifecycleUnsubs.push(unsubLoad, unsubReset);

    // Engine-level guard: block seek/reset/start/load while position open (not UI-only)
    if (!replayEngine._tradingGuardInstalled) {
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
    const idx = Number.isFinite(payload.index) ? payload.index : this._latestCandleIndex + 1;
    // clone
    this._latestCandle = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    this._latestCandleIndex = idx;
    // Update all open positions currentPrice
    let totalUnrealized = 0;
    for (const pos of this._positions.values()) {
      pos.currentPrice = this._latestCandle.close;
      totalUnrealized += pos.unrealizedPnL;
      this.emit(TradingEvents.POSITION_UPDATED, { position: this._cloneJSON(pos.toJSON()) });
    }
    this.account.unrealizedPnL = totalUnrealized;
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());

    // Execution order (documented):
    // 1) market candle arrives (above: currentPrice + ACCOUNT_UPDATED)
    // 2) position SL/TP evaluated (risk exits have priority)
    // 3) pending LIMIT/STOP orders evaluated (entry/exit)
    // 4) position/account updates + events emitted inside each step
    // This order is deterministic and hindsight-safe: only current candle OHLC is used.
    // Evaluate SL/TP before entry orders — deterministic risk exits have priority
    // Same-candle protection: position and SL/TP become eligible at next candle
    const closedThisCandle = this._processStopLossTakeProfit(this._latestCandle, idx);
    // Stale-exit protection: if SL/TP closed a position this candle, pending opposite-side
    // orders that existed before this candle are stale exits — they must not open a reversal.
    if (closedThisCandle && closedThisCandle.size > 0) {
      this._cancelStaleExitPendings(closedThisCandle, idx);
    }

    // Evaluate pending entry orders (LIMIT and STOP_MARKET) with next-candle protection
    this._processPendingOrders(this._latestCandle, idx);
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
  placeOrder({ symbol, side, quantity }) {
    // Validation
    const sideRes = TradingValidator.validateSide(side);
    if (!sideRes.valid) return this._reject(sideRes.code, sideRes.message);
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    const qtyRes = TradingValidator.validateQuantity(quantity);
    if (!qtyRes.valid) return this._reject(qtyRes.code, qtyRes.message);

    if (!this._latestCandle) {
      return this._reject('NO_MARKET_PRICE', 'Cannot place order before the first replay candle.');
    }

    const q = Number(quantity);
    const execPrice = this._latestCandle.close;
    const time = this._latestCandle.time;

    const existing = this._positions.get(symbol);

    // Same direction: reject
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        return this._reject('POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`, { symbol });
      }
      // Opposite direction: close existing (do not auto-reverse)
      const result = this._closePositionInternal(symbol, execPrice, time);
      // After market close, cancel incompatible limit pendings
      this._cancelIncompatiblePendings(symbol);
      return result;
    }

    // No existing position: open new
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const entryNotional = execPrice * q;
    const entryFee = calcFee(entryNotional, this.feeRate);
    // deduct entry fee immediately
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const position = new Position({
      symbol,
      side: posSide,
      quantity: q,
      entryPrice: execPrice,
      currentPrice: execPrice,
      openedAt: time,
      entryFee,
      openedIndex: this._latestCandleIndex,
    });
    this._positions.set(symbol, position);
    // unrealized 0 at open
    this._recalcUnrealized();
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    // After market open, reject incompatible pendings
    this._cancelIncompatiblePendings(symbol);
    return { success: true, position: this._cloneJSON(position.toJSON()), entryFee };
  }

  /**
   * Close position for symbol at current market price.
   */
  closePosition(symbol) {
    const symRes = TradingValidator.validateSymbol(symbol);
    if (!symRes.valid) return this._reject(symRes.code, symRes.message);
    if (!this._latestCandle) return this._reject('NO_MARKET_PRICE', 'No market price available to close.');
    const existing = this._positions.get(symbol);
    if (!existing) return this._reject('NO_POSITION', `No open position for ${symbol}`);

    const execPrice = this._latestCandle.close;
    const time = this._latestCandle.time;
    const res = this._closePositionInternal(symbol, execPrice, time);
    this._cancelIncompatiblePendings(symbol);
    return res;
  }

  _closePositionInternal(symbol, exitPrice, closedAt, exitReason = null) {
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
    });
    this._trades.push(trade);

    this._positions.delete(symbol);
    this._recalcUnrealized();

    this.emit(TradingEvents.POSITION_CLOSED, { symbol, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, exitPrice, exitReason, trade: this._cloneJSON(trade.toJSON()) });
    this.emit(TradingEvents.TRADE_EXECUTED, { trade: this._cloneJSON(trade.toJSON()) });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return { success: true, realizedPnL: net, grossPnL: gross, entryFee, exitFee, totalFee, netPnL: net, exitReason, trade: this._cloneJSON(trade.toJSON()), closedPosition: this._cloneJSON(pos.toJSON()) };
  }

  _closePositionWithReason(symbol, exitPrice, closedAt, exitReason) {
    return this._closePositionInternal(symbol, exitPrice, closedAt, exitReason);
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
    if (!this._latestCandle) {
      return this._reject('NO_MARKET_PRICE', 'Cannot place limit order before the first replay candle.');
    }
    const q = Number(quantity);
    const lp = Number(limitPrice);
    const orderId = `order-${this._nextOrderId++}`;
    const createdTime = this._latestCandle.time;
    const createdIdx = this._latestCandleIndex;
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
    if (!this._latestCandle) {
      return this._reject('NO_MARKET_PRICE', 'Cannot place stop order before the first replay candle.');
    }
    const q = Number(quantity);
    const sp = Number(stopPrice);
    const orderId = `order-${this._nextOrderId++}`;
    const createdTime = this._latestCandle.time;
    const createdIdx = this._latestCandleIndex;
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

  _processPendingOrders(candle, candleIndex) {
    if (this._pendingOrderIds.length === 0) return;
    const snapshot = [...this._pendingOrderIds];
    for (const id of snapshot) {
      const order = this._orders.get(id);
      if (!order) continue;
      if (order.status !== ORDER_STATUSES.PENDING) continue;
      if (order.createdIndex >= candleIndex) continue;
      let shouldFill = false;
      if (order.type === ORDER_TYPES.LIMIT) {
        if (order.side === 'BUY' && candle.low <= order.limitPrice) shouldFill = true;
        if (order.side === 'SELL' && candle.high >= order.limitPrice) shouldFill = true;
        if (shouldFill) { this._executeLimitFill(order, candle); continue; }
      } else if (order.type === ORDER_TYPES.STOP_MARKET) {
        if (order.side === 'BUY' && candle.high >= order.stopPrice) shouldFill = true;
        if (order.side === 'SELL' && candle.low <= order.stopPrice) shouldFill = true;
        if (shouldFill) { this._executeStopFill(order, candle); continue; }
      }
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

    // Position interaction
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        // same-side duplicate -> reject fill
        order.status = ORDER_STATUSES.REJECTED;
        order.rejectionReason = 'POSITION_ALREADY_OPEN';
        this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
        this._emitOrderRejected(order, 'POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`);
        return { success: false, code: 'POSITION_ALREADY_OPEN' };
      }
      // Opposite side -> close existing at limitPrice
      const filledPrice = limitPrice;
      order.status = ORDER_STATUSES.FILLED;
      order.filledAt = fillTime;
      order.filledPrice = filledPrice;
      // trigger event before fill for determinism
      this._emitOrderTriggeredIfNeeded(order);
      this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
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
      this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
      return { success: true, filled: true };
    }

    // No existing position -> open new
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const notional = limitPrice * qty;
    const entryFee = calcFee(notional, this.feeRate);
    const requiredCash = notional + entryFee;
    if (this.account.cashBalance < requiredCash) {
      order.status = ORDER_STATUSES.REJECTED;
      order.rejectionReason = 'INSUFFICIENT_CASH';
      this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
      this._emitOrderRejected(order, 'INSUFFICIENT_CASH', `Insufficient cash to fill BUY limit: required ${requiredCash.toFixed(2)}, available ${this.account.cashBalance.toFixed(2)}`);
      return { success: false, code: 'INSUFFICIENT_CASH' };
    }
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const position = new Position({
      symbol,
      side: posSide,
      quantity: qty,
      entryPrice: limitPrice,
      currentPrice: limitPrice,
      openedAt: fillTime,
      entryFee,
      openedIndex: candle.time ? this._latestCandleIndex : -1,
    });
    // ensure openedIndex tracks candle index for SL/TP protection
    position.openedIndex = this._latestCandleIndex;
    this._positions.set(symbol, position);
    order.status = ORDER_STATUSES.FILLED;
    order.filledAt = fillTime;
    order.filledPrice = limitPrice;
    order.entryFee = entryFee;
    this._emitOrderTriggeredIfNeeded(order);
    this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
    this._recalcUnrealized();
    this._emitOrderFilled(order);
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
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
    // trigger event first
    this._emitOrderTriggered(order);
    if (existing) {
      const existingLong = existing.side === 'LONG';
      const incomingLong = side === 'BUY';
      if ((existingLong && incomingLong) || (!existingLong && !incomingLong)) {
        order.status = ORDER_STATUSES.REJECTED;
        order.rejectionReason = 'POSITION_ALREADY_OPEN';
        this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
        this._emitOrderRejected(order, 'POSITION_ALREADY_OPEN', `Position already open for ${symbol} (${existing.side}). Close it first.`);
        return { success: false, code: 'POSITION_ALREADY_OPEN' };
      }
      const filledPrice = stopPrice;
      order.status = ORDER_STATUSES.FILLED;
      order.filledAt = fillTime;
      order.filledPrice = filledPrice;
      this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
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
      this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
      return { success: true, filled: true };
    }
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const notional = stopPrice * qty;
    const entryFee = calcFee(notional, this.feeRate);
    const requiredCash = notional + entryFee;
    if (this.account.cashBalance < requiredCash) {
      order.status = ORDER_STATUSES.REJECTED;
      order.rejectionReason = 'INSUFFICIENT_CASH';
      this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
      this._emitOrderRejected(order, 'INSUFFICIENT_CASH', `Insufficient cash to fill STOP: required ${requiredCash.toFixed(2)}, available ${this.account.cashBalance.toFixed(2)}`);
      return { success: false, code: 'INSUFFICIENT_CASH' };
    }
    this.account.cashBalance -= entryFee;
    this.account.totalFees += entryFee;
    const position = new Position({
      symbol,
      side: posSide,
      quantity: qty,
      entryPrice: stopPrice,
      currentPrice: stopPrice,
      openedAt: fillTime,
      entryFee,
      openedIndex: this._latestCandleIndex,
    });
    position.openedIndex = this._latestCandleIndex;
    this._positions.set(symbol, position);
    order.status = ORDER_STATUSES.FILLED;
    order.filledAt = fillTime;
    order.filledPrice = stopPrice;
    order.entryFee = entryFee;
    this._pendingOrderIds = this._pendingOrderIds.filter(i => i !== order.id);
    this._recalcUnrealized();
    this._emitOrderFilled(order);
    this.emit(TradingEvents.POSITION_OPENED, { position: this._cloneJSON(position.toJSON()), entryFee });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
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

  _processStopLossTakeProfit(candle, candleIndex) {
    const closed = new Map(); // symbol -> side
    // iterate positions snapshot
    for (const [symbol, pos] of [...this._positions.entries()]) {
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
      if (triggerSL && triggerTP) {
        // deterministic: SL wins
        triggerTP = false;
      }
      if (triggerSL) {
        const price = sl;
        const sideBefore = pos.side;
        this.emit(TradingEvents.STOP_LOSS_TRIGGERED, { symbol, price, position: this._cloneJSON(pos.toJSON()), candle: this._cloneJSON(candle) });
        this._closePositionWithReason(symbol, price, candle.time, 'STOP_LOSS');
        closed.set(symbol, sideBefore);
      } else if (triggerTP) {
        const price = tp;
        const sideBefore = pos.side;
        this.emit(TradingEvents.TAKE_PROFIT_TRIGGERED, { symbol, price, position: this._cloneJSON(pos.toJSON()), candle: this._cloneJSON(candle) });
        this._closePositionWithReason(symbol, price, candle.time, 'TAKE_PROFIT');
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
    if (!this._latestCandle) return this._reject('NO_MARKET_PRICE', 'Cannot set SL before first candle');
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.stopLossPrice = Number(price);
    pos.stopLossCreatedIndex = this._latestCandleIndex;
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
      return this._reject(pr.code === 'INVALID_STOP_PRICE' ? 'INVALID_TAKE_PROFIT_PRICE' : pr.code, pr.message);
    }
    if (!this._latestCandle) return this._reject('NO_MARKET_PRICE', 'Cannot set TP before first candle');
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    pos.takeProfitPrice = Number(price);
    pos.takeProfitCreatedIndex = this._latestCandleIndex;
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
    this.account.reset();
    this._clearPendingOrders('ACCOUNT_RESET');
    this.emit(TradingEvents.ACCOUNT_RESET, this.getAccountSnapshot());
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return this.getAccountSnapshot();
  }

  getAccountSnapshot() {
    const snap = this.account.snapshot();
    return { ...snap };
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
