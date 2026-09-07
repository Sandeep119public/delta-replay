import { createTradingPresentation } from './TradingPresentationAdapter.js';

/**
 * Application-owned facade for trading capabilities exposed to presentation code.
 * The UI receives this port instead of the PaperTradingEngine instance.
 *
 * @deprecated Prefer createTradingPresentation() (see TradingPresentationAdapter.js),
 * which exposes the narrow intent-shaped contract (snapshot/actions/events).
 * This engine-shaped facade is retained only for backward compatibility and is
 * implemented on top of the narrow presentation so both stay consistent.
 */
export function createTradingUIPort(tradingEngine) {
  const narrow = createTradingPresentation(tradingEngine);
  const snapshot = () => narrow.snapshot();
  const call = (method) => (...args) => tradingEngine?.[method]?.(...args);
  return Object.freeze({
    getAccountSnapshot: () => snapshot().account,
    getPerformanceStats: () => snapshot().stats,
    getPositions: () => snapshot().positions,
    getTrades: () => snapshot().trades,
    getPendingOrders: () => snapshot().pendingOrders,
    getOrders: () => snapshot().orders,
    getLatestCandle: () => {
      const markPrice = snapshot().markPrice;
      return markPrice == null ? null : { close: markPrice, price: markPrice };
    },
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
