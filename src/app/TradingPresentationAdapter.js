import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

const PRESENTATION_EVENT_NAMES = new Set(Object.values(TRADING_PRESENTATION_EVENTS));

function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

function latestMarkPrice(tradingEngine) {
  const candle = tradingEngine?.getLatestCandle?.();
  const price = Number(candle?.close ?? candle?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function assertPresentationEvent(event) {
  if (!PRESENTATION_EVENT_NAMES.has(event)) throw new TypeError(`Unsupported trading presentation event: ${String(event)}`);
  return event;
}

function subscribeAll(tradingEngine, handler) {
  if (typeof handler !== 'function') throw new TypeError('trading event handler must be a function');
  const unsubs = [...PRESENTATION_EVENT_NAMES].map((event) => tradingEngine.on?.(event, handler)).filter((fn) => typeof fn === 'function');
  return () => unsubs.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
}

export function createTradingPresentation(tradingEngine) {
  if (!tradingEngine || typeof tradingEngine !== 'object') throw new TypeError('createTradingPresentation requires a trading engine');

  const snapshot = () => {
    let account = null, positions = [], pendingOrders = [], orders = [], trades = [];
    let stats = { totalTrades: 0, winRate: 0, profitFactor: 0, netReturn: 0 };
    try {
      account = tradingEngine.getAccountSnapshot?.() ?? null;
      positions = tradingEngine.getPositions?.() ?? [];
      pendingOrders = tradingEngine.getPendingOrders?.() ?? [];
      orders = tradingEngine.getOrders?.() ?? [];
      trades = tradingEngine.getTrades?.() ?? [];
      stats = tradingEngine.getPerformanceStats?.() || stats;
    } catch {}
    const markPrice = latestMarkPrice(tradingEngine);
    return freezeValue({ account, positions, pendingOrders, orders, trades, stats, hasMarket: markPrice != null, markPrice });
  };

  const actions = Object.freeze({
    submitOrder: (order) => tradingEngine.submitOrder(order),
    closePosition: (symbol) => tradingEngine.closePosition(symbol),
    setRisk: (payload) => tradingEngine.setRisk(payload),
    clearRisk: (symbol) => tradingEngine.clearRisk(symbol),
    cancelOrder: (id) => tradingEngine.cancelOrder(id),
    cancelAll: (reason) => tradingEngine.cancelAll(reason),
    reset: () => tradingEngine.reset(),
    setStartingBalance: (balance) => tradingEngine.setStartingBalance(balance),
    setFeeRate: (rate) => tradingEngine.setFeeRate(rate),
    hasOpenPosition: (symbol) => tradingEngine.hasOpenPosition(symbol),
    hasOpenPosition: (symbol) => tradingEngine.hasOpenPosition(symbol),
  });

  return Object.freeze({
    snapshot,
    actions,
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine.on?.(assertPresentationEvent(event), handler),
    onAll: (handler) => subscribeAll(tradingEngine, handler),
  });
}
