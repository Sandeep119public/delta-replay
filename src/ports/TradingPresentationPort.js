/**
 * Neutral presentation boundary for trading integrations.
 * Domain-specific event names are copied into this contract so UI modules do
 * not need to import the trading domain event module.
 */
export const TRADING_PRESENTATION_EVENTS = Object.freeze({
  ORDER_PLACED: 'orderPlaced', ORDER_TRIGGERED: 'orderTriggered', ORDER_FILLED: 'orderFilled',
  ORDER_CANCELLED: 'orderCancelled', ORDER_REJECTED: 'orderRejected', POSITION_OPENED: 'positionOpened',
  POSITION_CLOSED: 'positionClosed', POSITION_UPDATED: 'positionUpdated', ACCOUNT_UPDATED: 'accountUpdated',
  TRADE_EXECUTED: 'tradeExecuted', ACCOUNT_RESET: 'accountReset', STOP_LOSS_TRIGGERED: 'stopLossTriggered',
  TAKE_PROFIT_TRIGGERED: 'takeProfitTriggered', BAR_CLOSE: 'barClose', POSITION_LIQUIDATED: 'positionLiquidated',
  FUNDING_PAYMENT: 'fundingPayment',
});

export const TRADING_PRESENTATION_PORT = Object.freeze({
  snapshot: Object.freeze({}),
  actions: Object.freeze({}),
  events: TRADING_PRESENTATION_EVENTS,
});
