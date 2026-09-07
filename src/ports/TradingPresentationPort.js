/**
 * Neutral presentation boundary for trading integrations.
 * Domain-specific event names are copied into this contract so UI modules do
 * not need to import the trading domain event module.
 *
 * Narrow contract (preferred):
 *   trading = {
 *     snapshot(): frozen { account, positions, pendingOrders, orders, trades, stats, hasMarket, markPrice },
 *     actions: frozen {
 *       submitMarketOrder, submitLimitOrder, submitStopOrder,
 *       flattenPosition, updateRisk, clearRisk,
 *       cancelOrder, resetAccount, setCapital, setFeeRate, hasOpenPosition
 *     },
 *     events: TRADING_PRESENTATION_EVENTS,
 *     on(event, handler): unsubscribe
 *   }
 *
 * UI views must be written against this intent-shaped contract, never against
 * engine-shaped getters such as getAccountSnapshot/getPositions/placeOrder.
 */
export const TRADING_PRESENTATION_EVENTS = Object.freeze({
  ORDER_PLACED: 'orderPlaced', ORDER_TRIGGERED: 'orderTriggered', ORDER_FILLED: 'orderFilled',
  ORDER_CANCELLED: 'orderCancelled', ORDER_REJECTED: 'orderRejected', POSITION_OPENED: 'positionOpened',
  POSITION_CLOSED: 'positionClosed', POSITION_UPDATED: 'positionUpdated', ACCOUNT_UPDATED: 'accountUpdated',
  TRADE_EXECUTED: 'tradeExecuted', ACCOUNT_RESET: 'accountReset', STOP_LOSS_TRIGGERED: 'stopLossTriggered',
  TAKE_PROFIT_TRIGGERED: 'takeProfitTriggered', BAR_CLOSE: 'barClose', POSITION_LIQUIDATED: 'positionLiquidated',
  FUNDING_PAYMENT: 'fundingPayment',
});

export const TRADING_PRESENTATION_ACTION_NAMES = Object.freeze([
  'submitMarketOrder', 'submitLimitOrder', 'submitStopOrder', 'flattenPosition',
  'updateRisk', 'setStopLoss', 'setTakeProfit', 'clearRisk', 'cancelOrder',
  'resetAccount', 'setCapital', 'setFeeRate', 'hasOpenPosition',
]);

const SNAPSHOT_KEYS = Object.freeze([
  'account', 'positions', 'pendingOrders', 'orders', 'trades', 'stats', 'hasMarket', 'markPrice',
]);

export function assertTradingPresentation(trading) {
  if (!trading || typeof trading !== 'object') throw new TypeError('trading presentation contract requires an object');
  if (typeof trading.snapshot !== 'function') throw new TypeError('trading presentation contract requires snapshot()');
  if (!trading.actions || typeof trading.actions !== 'object') throw new TypeError('trading presentation contract requires actions');
  if (!Object.isFrozen(trading.actions)) throw new TypeError('trading presentation actions must be frozen');
  for (const name of TRADING_PRESENTATION_ACTION_NAMES) {
    if (typeof trading.actions[name] !== 'function') throw new TypeError(`trading presentation contract requires actions.${name}`);
  }
  if (!trading.events || !Object.isFrozen(trading.events)) throw new TypeError('trading presentation events must be frozen');
  for (const name of Object.keys(TRADING_PRESENTATION_EVENTS)) {
    if (trading.events[name] !== TRADING_PRESENTATION_EVENTS[name]) throw new TypeError(`trading presentation event mismatch: ${name}`);
  }
  if (typeof trading.on !== 'function') throw new TypeError('trading presentation contract requires on(event, handler)');
  return trading;
}

export function assertTradingSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('trading snapshot must be an object');
  for (const key of SNAPSHOT_KEYS) {
    if (!(key in snapshot)) throw new TypeError(`trading snapshot is missing key: ${key}`);
  }
  if (!Object.isFrozen(snapshot)) throw new TypeError('trading snapshot must be frozen (immutable view model)');
  return snapshot;
}

export const TRADING_PRESENTATION_PORT = Object.freeze({
  snapshot: Object.freeze({}),
  actions: Object.freeze({}),
  events: TRADING_PRESENTATION_EVENTS,
});
