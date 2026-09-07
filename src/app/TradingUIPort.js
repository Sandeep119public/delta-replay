/**
 * Application-owned facade for trading capabilities exposed to presentation code.
 * The UI receives this port instead of the PaperTradingEngine instance.
 */
export function createTradingUIPort(tradingEngine) {
  const call = (method) => (...args) => tradingEngine?.[method]?.(...args);
  return Object.freeze({
    getAccountSnapshot: call('getAccountSnapshot'),
    getPerformanceStats: call('getPerformanceStats'),
    getPositions: call('getPositions'),
    getTrades: call('getTrades'),
    getPendingOrders: call('getPendingOrders'),
    getOrders: call('getOrders'),
    getLatestCandle: call('getLatestCandle'),
    hasOpenPosition: call('hasOpenPosition'),
    resetAccount: call('resetAccount'),
    setStartingBalance: call('setStartingBalance'),
    setFeeRate: call('setFeeRate'),
    placeOrder: call('placeOrder'),
    placeLimitOrder: call('placeLimitOrder'),
    placeStopOrder: call('placeStopOrder'),
    closePosition: call('closePosition'),
    setRisk: call('setRisk'),
    setStopLoss: call('setStopLoss'),
    setTakeProfit: call('setTakeProfit'),
    clearStopLoss: call('clearStopLoss'),
    clearTakeProfit: call('clearTakeProfit'),
    cancelOrder: call('cancelOrder'),
    on: call('on'),
  });
}
