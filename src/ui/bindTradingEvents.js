import { TradingEvents } from '../trading/TradingEvents.js';

export function bindTradingEvents({ tradingEngine, commandController, errorPanel }) {
  const subscriptions = [];
  const subscribe = (event, handler) => {
    const unsubscribe = tradingEngine?.on?.(event, handler);
    if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
  };

  subscribe(TradingEvents.POSITION_LIQUIDATED, (payload) => {
    try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); }
    errorPanel.show(
      { category: 'LIQUIDATION', userMessage: `Position liquidated: ${payload?.symbol || ''} @ ${payload?.liquidationPrice ?? '—'}`, message: 'Position liquidated', code: 'LIQUIDATION', context: {} },
      { severity: 'critical', onPause: () => { try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); } } },
    );
  });

  subscribe(TradingEvents.ORDER_REJECTED, (err) => {
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
