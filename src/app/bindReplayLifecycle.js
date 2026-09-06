import { ReplayEvents } from '../replay/ReplayEvents.js';

export function bindReplayLifecycle({ engine, appState, candleStore, timeline, modeBanner, coordinator, chartManager }) {
  const reveal = (idx) => {
    const candle = candleStore.get(idx);
    if (candle) chartManager.setRevealedMax(candle.time);
  };
  const subscriptions = [];
  subscriptions.push(engine.on(ReplayEvents.STATE_CHANGED, (state) => {
    appState.setReplayState(state);
    if (state.currentIndex >= 0) timeline.setPosition(state.currentIndex);
    modeBanner.update({ replayState: state, appState, candleStore });
  }));
  subscriptions.push(engine.on(ReplayEvents.STARTED, (payload) => {
    const idx = payload?.index ?? appState.pendingStartIndex;
    timeline.setPosition(idx);
    reveal(idx);
    modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  }));
  for (const event of [ReplayEvents.STEPPED, ReplayEvents.SEEKED]) {
    subscriptions.push(engine.on(event, (payload) => {
      modeBanner.update({ replayState: engine.getState(), appState, candleStore });
      if (payload?.index !== undefined) reveal(payload.index);
    }));
  }
  subscriptions.push(engine.on(ReplayEvents.RESET, (state) => {
    if (state.status === 'ready') {
      coordinator.updatePreviewWindow(appState.pendingStartIndex);
      reveal(appState.pendingStartIndex);
      timeline.setTotal(candleStore.getCount(), candleStore.getAll());
    } else if (state.index !== undefined) reveal(state.index);
    modeBanner.update({ replayState: state, appState, candleStore });
  }));
  return {
    reveal,
    destroy() {
      subscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch (error) { console.warn('[ReplayLifecycle] unsubscribe failed', error); } });
    },
  };
}
