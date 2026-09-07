import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

export function bindTradingEvents({ tradingEvents = null, tradingEngine = null, actions, errorPanel }) {
  const eventPort = tradingEvents || (tradingEngine ? {
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine.on?.(event, handler),
  } : null);
  if (!eventPort?.on) throw new TypeError('tradingEvents presentation port is required');

  const subscriptions = [];
  const subscribe = (event, handler) => {
    const unsubscribe = eventPort.on(event, handler);
    if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
  };

  subscribe(eventPort.events.POSITION_LIQUIDATED, (payload) => actions.handleLiquidation(payload));
  subscribe(eventPort.events.ORDER_REJECTED, (err) => {
    errorPanel.show(
      { category: 'ORDER', userMessage: err?.message || 'Order rejected', message: err?.message || 'Order rejected', code: err?.code || 'ORDER_REJECTED', context: {} },
      { severity: 'error', pauseReplay: false },
    );
  });

  return {
    destroy() {
      subscriptions.splice(0).forEach((unsubscribe) => {
        try { unsubscribe(); } catch (error) { console.warn('[TradingEvents] unsubscribe failed', error); }
      });
    },
  };
}
