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
  try {
    const candle = tradingEngine?.getLatestCandle?.();
    const price = Number(candle?.close ?? candle?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function assertPresentationEvent(event) {
  if (!PRESENTATION_EVENT_NAMES.has(event)) {
    throw new TypeError(`Unsupported trading presentation event: ${String(event)}`);
  }
  return event;
}

/**
 * Application-owned narrow trading presentation contract.
 * The UI receives intent-shaped actions plus one frozen snapshot() instead of
 * the engine-shaped facade (getAccountSnapshot/placeOrder/...).
 */
export function createTradingPresentation(tradingEngine) {
  if (!tradingEngine || typeof tradingEngine !== 'object') {
    throw new TypeError('createTradingPresentation requires a trading engine');
  }

  const snapshot = () => {
    let account = null;
    let positions = [];
    let pendingOrders = [];
    let orders = [];
    let trades = [];
    let stats = { totalTrades: 0, winRate: 0, profitFactor: 1, netReturn: 0 };
    try {
      account = tradingEngine.getAccountSnapshot?.() ?? null;
      positions = tradingEngine.getPositions?.() ?? [];
      pendingOrders = tradingEngine.getPendingOrders?.() ?? [];
      orders = tradingEngine.getOrders?.() ?? [];
      trades = tradingEngine.getTrades?.() ?? [];
      const computed = tradingEngine.getPerformanceStats?.();
      if (computed && typeof computed === 'object') stats = computed;
      else if (Array.isArray(trades)) stats = { ...stats, totalTrades: trades.length };
    } catch {
      // Snapshot must never throw; presentation renders the last-known state.
    }
    const markPrice = latestMarkPrice(tradingEngine);
    return freezeValue({
      account,
      positions,
      pendingOrders,
      orders,
      trades,
      stats,
      hasMarket: markPrice != null,
      markPrice,
    });
  };

  const actions = Object.freeze({
    submitMarketOrder: (order) => tradingEngine.placeOrder(order),
    submitLimitOrder: (order) => tradingEngine.placeLimitOrder(order),
    submitStopOrder: (order) => tradingEngine.placeStopOrder(order),
    flattenPosition: (symbol) => tradingEngine.closePosition(symbol),
    updateRisk: ({ symbol, stopLoss, takeProfit }) =>
      tradingEngine.setRisk({ symbol, stopLoss, takeProfit }),
    setStopLoss: (symbol, price) => tradingEngine.setStopLoss(symbol, price),
    setTakeProfit: (symbol, price) => tradingEngine.setTakeProfit(symbol, price),
    clearRisk: (symbol) => {
      tradingEngine.clearStopLoss?.(symbol);
      tradingEngine.clearTakeProfit?.(symbol);
      return { success: true };
    },
    cancelOrder: (orderId) => tradingEngine.cancelOrder(orderId),
    resetAccount: () => tradingEngine.resetAccount?.(),
    setCapital: (balance) => tradingEngine.setStartingBalance?.(balance),
    setFeeRate: (rate) => tradingEngine.setFeeRate?.(rate),
    hasOpenPosition: () => tradingEngine.hasOpenPosition?.() === true,
  });

  return Object.freeze({
    snapshot,
    actions,
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine.on?.(assertPresentationEvent(event), handler),
  });
}
