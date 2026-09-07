import { TradingEvents } from '../trading/TradingEvents.js';

export function bindTimelineInteractions({ timeline, tradingEngine, actions }) {
  timeline.onChange((idx) => actions.previewTimeline(idx));
  timeline.onCommit((idx) => actions.commitTimeline(idx));
  timeline.onStartHere((idx) => actions.startAt(idx));
  const refreshMarkers = () => {
    try {
      const trades = tradingEngine.getTrades?.() || [];
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
  const subscriptions = [
    tradingEngine.on(TradingEvents.TRADE_EXECUTED, refreshMarkers),
    tradingEngine.on(TradingEvents.POSITION_CLOSED, refreshMarkers),
  ];
  return {
    refreshMarkers,
    destroy() { subscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch (error) { console.warn('[Timeline] unsubscribe failed', error); } }); },
  };
}
