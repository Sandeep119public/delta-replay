/**
 * Deprecated compatibility shims for the presentation boundary.
 *
 * This is the ONLY module under src/ui that may reference engine-shaped
 * trading methods (getAccountSnapshot/placeOrder/...), store-shaped methods
 * (getCount/getAll/...), AppState fields, or coordinator methods. Every other
 * UI module is written against the narrow *Presentation contracts in
 * src/ports and must not name those legacy capabilities.
 *
 * Production wiring (Application.js) already passes narrow ports; these
 * helpers exist solely so older tests and external callers that still pass
 * engine/store/appState/coordinator objects keep working while they migrate.
 */

function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

function markPriceOf(source) {
  try {
    const candle = source?.getLatestCandle?.();
    const price = Number(candle?.close ?? candle?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function snapshotOf(source) {
  let account = null;
  let positions = [];
  let pendingOrders = [];
  let orders = [];
  let trades = [];
  let stats = { totalTrades: 0, winRate: 0, profitFactor: 1, netReturn: 0 };
  try {
    account = source?.getAccountSnapshot?.() ?? null;
    positions = source?.getPositions?.() ?? [];
    pendingOrders = source?.getPendingOrders?.() ?? [];
    orders = source?.getOrders?.() ?? [];
    trades = source?.getTrades?.() ?? [];
    const computed = source?.getPerformanceStats?.();
    if (computed && typeof computed === 'object') stats = computed;
    else if (Array.isArray(trades)) stats = { ...stats, totalTrades: trades.length };
  } catch {
    // Presentation must never throw while reading legacy state.
  }
  return freezeValue({
    account,
    positions,
    pendingOrders,
    orders,
    trades,
    stats,
    hasMarket: markPriceOf(source) != null,
    markPrice: markPriceOf(source),
  });
}

/**
 * Normalize any trading source into the narrow presentation shape
 * { snapshot, actions, events, on }.
 */
export function normalizeTradingSource(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('trading presentation requires a trading source');
  }
  if (typeof source.snapshot === 'function' && source.actions && typeof source.on === 'function') {
    return source;
  }
  const actions = Object.freeze({
    submitMarketOrder: (order) => source.placeOrder(order),
    submitLimitOrder: (order) => source.placeLimitOrder(order),
    submitStopOrder: (order) => source.placeStopOrder(order),
    flattenPosition: (symbol) => source.closePosition(symbol),
    updateRisk: ({ symbol, stopLoss, takeProfit }) => source.setRisk({ symbol, stopLoss, takeProfit }),
    setStopLoss: (symbol, price) => source.setStopLoss?.(symbol, price),
    setTakeProfit: (symbol, price) => source.setTakeProfit?.(symbol, price),
    clearRisk: (symbol) => {
      source.clearStopLoss?.(symbol);
      source.clearTakeProfit?.(symbol);
      return { success: true };
    },
    cancelOrder: (orderId) => source.cancelOrder(orderId),
    resetAccount: () => source.resetAccount?.(),
    setCapital: (balance) => source.setStartingBalance?.(balance),
    setFeeRate: (rate) => source.setFeeRate?.(rate),
    hasOpenPosition: () => source.hasOpenPosition?.() === true,
  });
  return Object.freeze({
    snapshot: () => snapshotOf(source),
    actions,
    events: source.events ?? null,
    on: (event, handler) => source.on?.(event, handler),
  });
}

/**
 * Normalize any candle source into { getCount, get, getAll, findIndexByTime }.
 */
export function normalizeCandleSource(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('candle view requires a source');
  }
  if (
    typeof source.getCount === 'function' &&
    typeof source.get === 'function' &&
    typeof source.getAll === 'function' &&
    typeof source.findIndexByTime === 'function'
  ) {
    return source;
  }
  return Object.freeze({
    getCount: () => source.getCount?.() ?? source.getAll?.()?.length ?? 0,
    get: (index) => source.get?.(index) ?? source.getAll?.()?.[index] ?? null,
    getAll: () => source.getAll?.() ?? [],
    findIndexByTime: (t) => source.findIndexByTime?.(t) ?? -1,
  });
}

/**
 * Normalize dataset sources: view model { symbol, timeframe },
 * legacy AppState { symbol, timeframe }, or explicit { value } wrappers.
 */
export function normalizeDatasetSource(source, kind) {
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object') return null;
  if (kind === 'symbol') {
    return source.symbol ?? source.value ?? source.currentSymbol ?? null;
  }
  return source.timeframe ?? source.value ?? source.currentTimeframe ?? null;
}
