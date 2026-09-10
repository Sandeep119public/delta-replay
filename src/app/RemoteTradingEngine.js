import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

class Events {
  constructor() { this.map = new Map(); }
  on(event, handler) { const listeners = this.map.get(event) || new Set(); listeners.add(handler); this.map.set(event, listeners); return () => listeners.delete(handler); }
  emit(event, payload) { for (const handler of this.map.get(event) || []) { try { handler(payload); } catch (error) { console.warn(`[RemoteTradingEngine] ${event} handler failed`, error); } } }
}

const EVENT = TRADING_PRESENTATION_EVENTS;
const clone = (value) => value == null ? value : structuredClone(value);
function number(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function normalizePosition(raw) {
  if (!raw) return null;
  const entryPrice = number(raw.entryPrice ?? raw.entry_price);
  const currentPrice = number(raw.currentPrice ?? raw.current_price, entryPrice);
  const quantity = number(raw.quantity, 0);
  const side = String(raw.side || '').toUpperCase();
  const unrealizedPnL = number(raw.unrealizedPnL ?? raw.unrealized_pnl, entryPrice != null && currentPrice != null ? (currentPrice - entryPrice) * quantity * (side === 'SHORT' ? -1 : 1) : 0);
  return { ...clone(raw), symbol: String(raw.symbol || '').toUpperCase(), side, quantity, entryPrice, currentPrice, unrealizedPnL, stopLossPrice: number(raw.stopLossPrice ?? raw.stop_loss), takeProfitPrice: number(raw.takeProfitPrice ?? raw.take_profit) };
}
function normalizeAccount(raw = {}) {
  return { ...clone(raw), startingBalance: number(raw.startingBalance ?? raw.starting_balance, 0), cashBalance: number(raw.cashBalance ?? raw.walletBalance ?? raw.wallet_balance, 0), walletBalance: number(raw.walletBalance ?? raw.wallet_balance ?? raw.cashBalance, 0), equity: number(raw.equity, 0), realizedPnL: number(raw.realizedPnL ?? raw.realized_pnl, 0), unrealizedPnL: number(raw.unrealizedPnL ?? raw.unrealized_pnl, 0), totalFees: number(raw.totalFees ?? raw.total_fees, 0), availableMargin: number(raw.availableMargin ?? raw.available_margin, 0), usedMargin: number(raw.usedMargin ?? raw.used_margin, 0) };
}

export class RemoteTradingEngine {
  constructor(api) {
    if (!api || typeof api.request !== 'function') throw new TypeError('RemoteTradingEngine requires API client');
    this.api = api;
    this.events = new Events();
    this.data = { account: normalizeAccount(), positions: [], orders: [], pendingOrders: [], trades: [] };
    this.latestCandle = null;
    this._generation = 0;
    this._requestSequence = 0;
    this._pendingRequests = new Set();
    this._lastAppliedRequest = 0;
    this._destroyed = false;
    this._refreshPromise = this.refresh().catch(() => null);
  }
  on(event, handler) { return this._destroyed ? () => {} : this.events.on(event, handler); }
  async _request(path, options = {}, action = null, generation = this._generation) {
    const requestSequence = ++this._requestSequence;
    this._pendingRequests.add(requestSequence);
    try {
      const response = await this.api.request(path, options);
      const newerRequestPending = [...this._pendingRequests].some((sequence) => sequence > requestSequence);
      if (this._destroyed || generation !== this._generation || newerRequestPending || requestSequence < this._lastAppliedRequest) return { applied: false, response };
      this._lastAppliedRequest = requestSequence;
      const previous = this.data;
      this._sync(response, action, previous);
      return { applied: true, response };
    } finally {
      this._pendingRequests.delete(requestSequence);
    }
  }
  _sync(response = {}, action = null, previous = this.data) {
    if (this._destroyed) return;
    if (response.account) this.data.account = normalizeAccount(response.account);
    if (Array.isArray(response.positions)) this.data.positions = response.positions.map(normalizePosition).filter(Boolean);
    if (Array.isArray(response.orders)) this.data.orders = clone(response.orders);
    if (Array.isArray(response.pendingOrders)) this.data.pendingOrders = clone(response.pendingOrders); else this.data.pendingOrders = this.data.orders.filter((order) => order.status === 'PENDING');
    if (Array.isArray(response.trades)) this.data.trades = clone(response.trades);
    if (response.candle) this.latestCandle = clone(response.candle);
    this.events.emit(EVENT.ACCOUNT_UPDATED, this.getAccountSnapshot());
    this._emitStateTransitions(previous, action, response?.events || []);
  }
  syncFromReplayStep(response = {}) { if (this._destroyed) return this.getStateSnapshot(); const previous = this.data; this._sync({ ...(response?.trading || {}), candle: response?.candle, events: response?.events || [] }, 'candle', previous); return this.getStateSnapshot(); }
  getStateSnapshot() { return { account: this.getAccountSnapshot(), positions: this.getPositions(), orders: this.getOrders(), pendingOrders: this.getPendingOrders(), trades: this.getTrades() }; }
  _emitStateTransitions(previous, action, backendEvents) {
    const beforePositions = previous.positions || [], afterPositions = this.data.positions || [], beforeOrders = previous.orders || [], afterOrders = this.data.orders || [], beforeTrades = previous.trades || [];
    const backendOrderEvents = new Set(backendEvents.filter((event) => ['ORDER_FILLED', 'ORDER_REJECTED'].includes(String(event?.type || '').toUpperCase())).map((event) => String(event.order?.id ?? event.order ?? '')));
    if (afterPositions.length > beforePositions.length) this.events.emit(EVENT.POSITION_OPENED, clone(afterPositions[0]));
    if (afterPositions.length < beforePositions.length) this.events.emit(EVENT.POSITION_CLOSED, clone(beforePositions[0]));
    if (afterPositions.length === beforePositions.length && afterPositions.length > 0 && JSON.stringify(beforePositions[0]) !== JSON.stringify(afterPositions[0])) this.events.emit(EVENT.POSITION_UPDATED, clone(afterPositions[0]));
    for (const order of afterOrders) {
      const before = beforeOrders.find((candidate) => candidate.id === order.id);
      const orderEventKey = String(order.id ?? '');
      if (!before && action === 'place') this.events.emit(EVENT.ORDER_PLACED, clone(order));
      if (before?.status !== order.status && order.status === 'FILLED' && !backendOrderEvents.has(orderEventKey)) { this.events.emit(EVENT.ORDER_TRIGGERED, clone(order)); this.events.emit(EVENT.ORDER_FILLED, { order: clone(order) }); }
      if (before?.status !== order.status && order.status === 'CANCELLED') this.events.emit(EVENT.ORDER_CANCELLED, clone(order));
      if (before?.status !== order.status && order.status === 'REJECTED' && !backendOrderEvents.has(orderEventKey)) this.events.emit(EVENT.ORDER_REJECTED, clone(order));
    }
    if (this.data.trades.length > beforeTrades.length) this.events.emit(EVENT.TRADE_EXECUTED, clone(this.data.trades[this.data.trades.length - 1]));
    for (const event of backendEvents) { const type = String(event?.type || '').toUpperCase(); if (type === 'ORDER_FILLED') { const order = event.order && typeof event.order === 'object' ? event.order : null; this.events.emit(EVENT.ORDER_TRIGGERED, order ? clone(order) : clone(event)); this.events.emit(EVENT.ORDER_FILLED, clone(event)); } else if (type === 'ORDER_REJECTED') this.events.emit(EVENT.ORDER_REJECTED, clone(event)); else if (type === 'STOP_LOSS') this.events.emit(EVENT.STOP_LOSS_TRIGGERED, clone(event)); else if (type === 'TAKE_PROFIT') this.events.emit(EVENT.TAKE_PROFIT_TRIGGERED, clone(event)); else if (type === 'LIQUIDATION') this.events.emit(EVENT.POSITION_LIQUIDATED, clone(event)); }
    if (action === 'reset') this.events.emit(EVENT.ACCOUNT_RESET, this.getAccountSnapshot());
    if (action === 'candle') this.events.emit(EVENT.BAR_CLOSE, this.getLatestCandle());
  }
  getAccountSnapshot() { return clone(this.data.account); }
  getPositions() { return clone(this.data.positions); }
  getOrders() { return clone(this.data.orders); }
  getPendingOrders() { return clone(this.data.pendingOrders); }
  getTrades() { return clone(this.data.trades); }
  hasOpenPosition(symbol = null) { return symbol ? this.data.positions.some((p) => p.symbol === String(symbol).toUpperCase()) : this.data.positions.length > 0; }
  getLatestCandle() { return clone(this.latestCandle); }
  getPerformanceStats() { const trades = this.data.trades; const wins = trades.filter((trade) => Number(trade.netPnL ?? 0) > 0); const grossWin = wins.reduce((sum, trade) => sum + Number(trade.netPnL || 0), 0); const grossLoss = Math.abs(trades.filter((trade) => Number(trade.netPnL ?? 0) < 0).reduce((sum, trade) => sum + Number(trade.netPnL || 0), 0)); const net = trades.reduce((sum, trade) => sum + Number(trade.netPnL || 0), 0); const starting = Number(this.data.account.startingBalance || 0); return { totalTrades: trades.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0), netReturn: starting > 0 ? (net / starting) * 100 : 0 }; }
  async refresh() { if (this._destroyed) return this.getStateSnapshot(); const result = await this._request('/state', {}, 'refresh'); return result.response; }
  async _action(path, options, action) { if (this._destroyed) return { success: false, message: 'Trading engine is destroyed' }; try { const requestSequence = this._requestSequence + 1; const result = await this._request(path, options, action); if (this._destroyed) return { success: false, message: 'Trading engine is destroyed' }; if (!result.applied) return { success: true, ...this.getStateSnapshot(), stale: true }; if (this._lastAppliedRequest !== requestSequence) return { success: true, ...this.getStateSnapshot(), stale: true }; return { success: true, ...result.response }; } catch (error) { return { success: false, message: error?.message || 'Trading request failed', status: error?.status, error }; } }
  submitMarketOrder(order) { return this._action('/order', { method: 'POST', body: JSON.stringify({ symbol: order.symbol, side: String(order.side).toLowerCase(), quantity: order.quantity, type: 'market' }) }, 'place'); }
  placeLimitOrder(order) { return this._action('/order', { method: 'POST', body: JSON.stringify({ symbol: order.symbol, side: String(order.side).toLowerCase(), quantity: order.quantity, type: 'limit', limitPrice: order.limitPrice }) }, 'place'); }
  placeStopOrder(order) { return this._action('/order', { method: 'POST', body: JSON.stringify({ symbol: order.symbol, side: String(order.side).toLowerCase(), quantity: order.quantity, type: 'stop_market', stopPrice: order.stopPrice }) }, 'place'); }
  placeOrder(order) { return this.submitMarketOrder(order); }
  flattenPosition(symbol) { return this._action('/close', { method: 'POST', body: JSON.stringify({ symbol: String(symbol).toUpperCase() }) }, 'close'); }
  closePosition(symbol) { return this.flattenPosition(symbol); }
  updateRisk({ symbol, stopLoss, takeProfit }) { return this._action('/risk', { method: 'POST', body: JSON.stringify({ symbol: String(symbol).toUpperCase(), stopLoss, takeProfit }) }, 'risk'); }
  setRisk({ symbol, stopLoss, takeProfit }) { return this.updateRisk({ symbol, stopLoss, takeProfit }); }
  setStopLoss(symbol, price) { const position = this.getPositions().find((candidate) => candidate.symbol === String(symbol).toUpperCase()); return this.updateRisk({ symbol, stopLoss: price, takeProfit: position?.takeProfitPrice ?? null }); }
  setTakeProfit(symbol, price) { const position = this.getPositions().find((candidate) => candidate.symbol === String(symbol).toUpperCase()); return this.updateRisk({ symbol, stopLoss: position?.stopLossPrice ?? null, takeProfit: price }); }
  clearRisk(symbol) { return this._action(`/risk/clear?symbol=${encodeURIComponent(String(symbol).toUpperCase())}`, { method: 'POST' }, 'risk'); }
  clearStopLoss(symbol) { return this._action(`/risk/clear?symbol=${encodeURIComponent(String(symbol).toUpperCase())}&target=stopLoss`, { method: 'POST' }, 'risk'); }
  clearTakeProfit(symbol) { return this._action(`/risk/clear?symbol=${encodeURIComponent(String(symbol).toUpperCase())}&target=takeProfit`, { method: 'POST' }, 'risk'); }
  clearPendingOrders(reason = null) { const query = reason ? `?reason=${encodeURIComponent(String(reason))}` : ''; return this._action(`/orders/cancel-all${query}`, { method: 'POST' }, 'cancel'); }
  cancelOrder(id) { return this._action(`/orders/${id}/cancel`, { method: 'POST' }, 'cancel'); }
  resetAccount() { return this._action('/reset', { method: 'POST' }, 'reset'); }
  setStartingBalance(balance) { return this._action('/account/capital', { method: 'POST', body: JSON.stringify({ balance }) }, 'capital'); }
  setCapital(balance) { return this.setStartingBalance(balance); }
  setFeeRate(rate) { return this._action('/account/fee-rate', { method: 'POST', body: JSON.stringify({ rate }) }, 'fee'); }
  async onMarketCandle(payload = null) { if (this._destroyed) return { success: false, message: 'Trading engine is destroyed' }; const candle = payload?.candle || null; const body = candle ? JSON.stringify({ symbol: String(payload.symbol || candle.symbol || 'BTCUSDT').toUpperCase(), candle, index: payload.index ?? null }) : undefined; try { const requestSequence = this._requestSequence + 1; const result = await this._request('/candle', { method: 'POST', ...(body ? { body } : {}) }, 'candle'); return this._destroyed ? { success: false, message: 'Trading engine is destroyed' } : result.applied && this._lastAppliedRequest === requestSequence ? result.response : { success: true, ...this.getStateSnapshot(), stale: true }; } catch (error) { return { success: false, message: error?.message || 'Trading request failed', error }; } }
  destroy() { if (this._destroyed) return; this._destroyed = true; this._generation++; this.events = new Events(); this.latestCandle = null; }
}
