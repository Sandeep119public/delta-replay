import { TradingEvents } from '../trading/TradingEvents.js';

export function bindTimelineInteractions({ timeline, controls, appState, engine, candleStore, tradingEngine, commandController, coordinator, modeBanner }) {
  timeline.onChange((idx) => {
    appState.setPendingStartIndex(idx);
    controls.setStartIndex(idx);
    modeBanner.update({ replayState: engine.getState(), appState, candleStore });
    const st = engine.getState();
    if (st.status === 'ready' || st.status === 'idle') coordinator.updatePreviewWindow(idx);
  });
  timeline.onCommit((idx) => {
    const st = engine.getState();
    if (st.status === 'paused' || st.status === 'playing' || st.status === 'ended') {
      if (st.status === 'playing') commandController.pause();
      const ok = commandController.trySeek(idx);
      if (!ok) timeline.setPosition(st.currentIndex);
    } else {
      appState.setPendingStartIndex(idx);
      controls.setStartIndex(idx);
      modeBanner.update({ replayState: st, appState, candleStore });
      coordinator.updatePreviewWindow(idx);
    }
  });
  timeline.onStartHere((idx) => {
    const n = Number(idx);
    if (!Number.isFinite(n) || n < 0) return;
    appState.setPendingStartIndex(n);
    controls.setStartIndex(n);
    commandController.startAt(n);
  });
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
  tradingEngine.on(TradingEvents.TRADE_EXECUTED, refreshMarkers);
  tradingEngine.on(TradingEvents.POSITION_CLOSED, refreshMarkers);
  return { refreshMarkers };
}
