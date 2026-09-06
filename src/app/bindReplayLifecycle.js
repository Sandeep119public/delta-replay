import { ReplayEvents } from '../replay/ReplayEvents.js';

export function bindReplayLifecycle({ engine, appState, candleStore, timeline, modeBanner, coordinator, chartManager }) {
  const reveal = (idx) => {
    const candle = candleStore.get(idx);
    if (candle) chartManager.setRevealedMax(candle.time);
  };
  const subscriptions = [];
  const on = (event, handler) => { const unsubscribe = engine.on(event, handler); if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe); };
  on(ReplayEvents.STATE_CHANGED, (state) => {
    appState.setReplayState(state);
    if (state.currentIndex >= 0) timeline.setPosition(state.currentIndex);
    modeBanner.update({ replayState: state, appState, candleStore });
  });
  on(ReplayEvents.STARTED, (payload) => {
    const idx = payload?.index ?? appState.pendingStartIndex;
    timeline.setPosition(idx);
    reveal(idx);
    modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  });
  for (const event of [ReplayEvents.STEPPED, ReplayEvents.SEEKED]) {
    on(event, (payload) => {
      modeBanner.update({ replayState: engine.getState(), appState, candleStore });
      if (payload?.index !== undefined) reveal(payload.index);
    });
  }
  on(ReplayEvents.RESET, (state) => {
    if (state.status === 'ready') {
      coordinator.updatePreviewWindow(appState.pendingStartIndex);
      reveal(appState.pendingStartIndex);
      timeline.setTotal(candleStore.getCount(), candleStore.getAll());
    } else if (state.index !== undefined) reveal(state.index);
    modeBanner.update({ replayState: state, appState, candleStore });
  });
  return () => { for (const unsubscribe of subscriptions.splice(0)) unsubscribe(); };
}
