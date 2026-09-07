import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';

export function bindTimelineInteractions({ timeline, tradingEngine = null, tradingEvents = null, candleStore, actions }) {
  timeline.onChange((idx) => actions.previewTimeline(idx));
  timeline.onCommit((idx) => actions.commitTimeline(idx));
  timeline.onStartHere((idx) => actions.startAt(idx));

  const eventPort = tradingEvents || (tradingEngine ? {
    events: TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingEngine.on?.(event, handler),
  } : null);
  if (!candleStore) throw new TypeError('candleStore is required');

  const refreshMarkers = () => {
    try {
      const trades = eventPort?.snapshot?.()?.trades || tradingEngine?.getTrades?.() || [];
      if (!trades.length || !candleStore.getCount()) return timeline.setMarkers([]);
      const all = candleStore.getAll?.() || [];
      const markers = [];
      for (const t of trades) {
        const ts = t.openedAt ?? t.entryTime ?? t.time;
        let index = Number.isInteger(t.entryIndex) ? t.entryIndex : -1;
        if (index < 0 && Number.isFinite(ts)) {
          let lo = 0, hi = all.length - 1;
          while (lo <= hi) {
            const mid = lo + Math.floor((hi - lo) / 2);
            if (all[mid].time <= ts) { index = mid; lo = mid + 1; } else hi = mid - 1;
          }
          if (index < 0) index = 0;
        }
        if (index >= 0) markers.push({ index, side: t.side });
      }
      timeline.setMarkers(markers);
    } catch (error) { console.warn('[Timeline] marker refresh failed', error); }
  };

  const subscriptions = [];
  if (eventPort?.on) {
    const events = eventPort.events || TRADING_PRESENTATION_EVENTS;
    [events.TRADE_EXECUTED, events.POSITION_CLOSED].forEach((event) => {
      const unsubscribe = eventPort.on(event, refreshMarkers);
      if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
    });
  }
  refreshMarkers();

  return {
    refreshMarkers,
    destroy() {
      subscriptions.splice(0).forEach((unsubscribe) => {
        try { unsubscribe?.(); } catch (error) { console.warn('[Timeline] unsubscribe failed', error); }
      });
    },
  };
}
