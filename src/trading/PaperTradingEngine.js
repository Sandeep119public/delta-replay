import { EventEmitter } from '../core/EventEmitter.js';
import { TradingAccount } from './TradingAccount.js';
import { Position } from './Position.js';
import { Trade } from './Trade.js';
import { TradingEvents } from './TradingEvents.js';
import { TradingValidator } from './TradingValidator.js';

/**
 * PaperTradingEngine — consumes MARKET_CANDLE only.
 * Never touches AppState.candles, ReplayEngine._candles, Chart data, Timeline.
 *
 * Deterministic: execution price = latest candle close.
 * One position per symbol.
 */
export class PaperTradingEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} [opts.startingBalance=10000]
   * @param {import('../replay/ReplayEngine.js').ReplayEngine} [opts.replayEngine] - optional auto-wire
   */
  constructor({ startingBalance = 10000, replayEngine = null } = {}) {
    super();
    this.account = new TradingAccount({ startingBalance });
    this._positions = new Map(); // symbol -> Position
    this._trades = [];
    this._nextTradeId = 1;
    this._latestCandle = null; // cloned
    this._latestSymbolContext = null; // last candle's implied? we use order symbol
    this._replayEngine = null;
    this._unsubs = [];
    if (replayEngine) this.attachToReplay(replayEngine);
  }

  attachToReplay(replayEngine) {
    if (this._replayEngine === replayEngine && this._unsubs.length > 0) return; // idempotent
    this.detach();
    this._replayEngine = replayEngine;
    // MARKET_CANDLE payload: {candle, index, timestamp, replayState}
    const unsubCandle = replayEngine.on('marketCandle', (payload) => this.onMarketCandle(payload));
    // Do not subscribe to other events; seek/reset handled via application guard
    this._unsubs.push(unsubCandle);
  }

  detach() {
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
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
    // clone
    this._latestCandle = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    // Update all open positions currentPrice
    let totalUnrealized = 0;
    for (const pos of this._positions.values()) {
      pos.currentPrice = this._latestCandle.close;
      totalUnrealized += pos.unrealizedPnL;
      this.emit(TradingEvents.POSITION_UPDATED, { position: pos.clone().toJSON() });
    }
    this.account.unrealizedPnL = totalUnrealized;
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
  }

  _reject(code, message, extra = {}) {
    const err = { success: false, code, message, ...extra };
    this.emit(TradingEvents.ORDER_REJECTED, err);
    return err;
  }

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
      return this._closePositionInternal(symbol, execPrice, time);
    }

    // No existing position: open new
    const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
    const position = new Position({
      symbol,
      side: posSide,
      quantity: q,
      entryPrice: execPrice,
      currentPrice: execPrice,
      openedAt: time,
    });
    this._positions.set(symbol, position);
    // unrealized 0 at open
    this._recalcUnrealized();
    this.emit(TradingEvents.POSITION_OPENED, { position: position.clone().toJSON() });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return { success: true, position: position.clone().toJSON() };
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
    return this._closePositionInternal(symbol, execPrice, time);
  }

  _closePositionInternal(symbol, exitPrice, closedAt) {
    const pos = this._positions.get(symbol);
    if (!pos) return this._reject('NO_POSITION', `No open position for ${symbol}`);
    const realized = pos.side === 'LONG'
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;

    this.account.cashBalance += realized;
    this.account.realizedPnL += realized;

    const trade = new Trade({
      id: this._nextTradeId++,
      symbol: pos.symbol,
      side: pos.side,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice,
      openedAt: pos.openedAt,
      closedAt,
      realizedPnL: realized,
    });
    this._trades.push(trade);

    this._positions.delete(symbol);
    this._recalcUnrealized();

    this.emit(TradingEvents.POSITION_CLOSED, { symbol, realizedPnL: realized, exitPrice, trade: trade.clone().toJSON() });
    this.emit(TradingEvents.TRADE_EXECUTED, { trade: trade.clone().toJSON() });
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return { success: true, realizedPnL: realized, trade: trade.clone().toJSON(), closedPosition: pos.clone().toJSON() };
  }

  _recalcUnrealized() {
    let total = 0;
    for (const p of this._positions.values()) total += p.unrealizedPnL;
    this.account.unrealizedPnL = total;
  }

  resetAccount() {
    this._positions.clear();
    this._trades = [];
    this._nextTradeId = 1;
    this.account.reset();
    this.emit(TradingEvents.ACCOUNT_RESET, this.getAccountSnapshot());
    this.emit(TradingEvents.ACCOUNT_UPDATED, this.getAccountSnapshot());
    return this.getAccountSnapshot();
  }

  getAccountSnapshot() {
    const snap = this.account.snapshot();
    // clone
    return { ...snap };
  }

  getPosition(symbol) {
    const p = this._positions.get(symbol);
    return p ? p.clone().toJSON() : null;
  }

  getPositions() {
    return Array.from(this._positions.values()).map(p => p.clone().toJSON());
  }

  getTrades() {
    return this._trades.map(t => t.clone().toJSON());
  }

  hasOpenPosition(symbol = null) {
    if (symbol) return this._positions.has(symbol);
    return this._positions.size > 0;
  }

  canSeek() {
    // Disallow seek while position open (safe)
    return !this.hasOpenPosition();
  }

  getLatestCandle() {
    return this._latestCandle ? { ...this._latestCandle } : null;
  }

  // For testing future-data safety: ensure engine has no reference to AppState etc.
  // No-op, but we expose that internal methods don't hold external arrays.
}
