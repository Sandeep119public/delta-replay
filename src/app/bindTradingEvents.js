import { TradingEvents } from '../trading/TradingEvents.js';

export function bindTradingEvents({ tradingEngine, commandController, errorPanel }) {
  const subscriptions = [];
  const on = (event, handler) => { const unsubscribe = on(event, handler); if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe); };
  on(TradingEvents.POSITION_LIQUIDATED, (payload) => {
    try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); }
    errorPanel.show(
      { category: 'LIQUIDATION', userMessage: `Position liquidated: ${payload?.symbol || ''} @ ${payload?.liquidationPrice ?? '—'}`, message: 'Position liquidated', code: 'LIQUIDATION', context: {} },
      { severity: 'critical', onPause: () => { try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); } } },
    );
  });
  on(TradingEvents.ORDER_REJECTED, (err) => {
    errorPanel.show(
      { category: 'ORDER', userMessage: err?.message || 'Order rejected', message: err?.message || 'Order rejected', code: err?.code || 'ORDER_REJECTED', context: {} },
      { severity: 'error', pauseReplay: false },
    );
  });
  return () => { for (const unsubscribe of subscriptions.splice(0)) unsubscribe(); };
}
