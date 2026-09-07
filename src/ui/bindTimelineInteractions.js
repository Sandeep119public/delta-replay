import { TRADING_PRESENTATION_EVENTS } from '../ports/TradingPresentationPort.js';
import { normalizeCandleSource, normalizeTradingSource } from './presentationCompat.js';

export function bindTimelineInteractions({ timeline, candles = null, trading = null, tradingEvents = null, tradingState = null, actions }) {
  timeline.onChange((idx) => actions.previewTimeline(idx));
  timeline.onCommit((idx) => actions.commitTimeline(idx));
  timeline.onStartHere((idx) => actions.startAt(idx));
  if (!candles) throw new TypeError('candle view is required');
  const candleView = normalizeCandleSource(candles);
  const tradingView = trading ? normalizeTradingSource(trading) : null;

  const eventPort = tradingEvents || (tradingView ? {
    events: tradingView.events || TRADING_PRESENTATION_EVENTS,
    on: (event, handler) => tradingView.on?.(event, handler),
  } : null);

  const refreshMarkers = () => {
    try {
      const trades = tradingState?.snapshot?.().trades || tradingView?.snapshot().trades || [];
      if (!trades.length || !candleView.getCount()) return timeline.setMarkers([]);
      const all = candleView.getAll?.() || [];
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
