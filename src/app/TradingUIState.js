/**
 * Read-only adapter from the trading domain to UI-friendly snapshots.
 */
export function createTradingUIState(tradingEngine) {
  const snapshot = () => ({
    account: tradingEngine.getAccountSnapshot?.() || null,
    positions: tradingEngine.getPositions?.() || [],
    pendingOrders: tradingEngine.getPendingOrders?.() || [],
    orders: tradingEngine.getOrders?.() || [],
    trades: tradingEngine.getTrades?.() || [],
  });
  return {
    snapshot,
    activePosition() { return snapshot().positions[0] || null; },
  };
}
