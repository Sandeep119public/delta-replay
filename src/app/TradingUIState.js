/**
 * Read-only adapter from the trading domain to immutable UI snapshots.
 */
function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

export function createTradingUIState(tradingEngine) {
  const snapshot = () => freezeValue({
    account: tradingEngine.getAccountSnapshot?.() || null,
    positions: tradingEngine.getPositions?.() || [],
    pendingOrders: tradingEngine.getPendingOrders?.() || [],
    orders: tradingEngine.getOrders?.() || [],
    trades: tradingEngine.getTrades?.() || [],
  });

  return Object.freeze({
    snapshot,
    activePosition() { return snapshot().positions[0] || null; },
  });
}
