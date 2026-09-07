import { ReplayEvents } from '../replay/ReplayEvents.js';

export function bindReplayLifecycle({ engine, appState, candleStore, statusView = null, timeline, modeBanner, coordinator, chartManager }) {
  const reveal = (idx) => {
    const candle = candleStore.get(idx);
    if (candle) chartManager.setRevealedMax(candle.time);
  };
  const reportStatus = () => {
    if (statusView) modeBanner.update(statusView.snapshot());
    else modeBanner.update({ replayState: engine.getState(), appState, candleStore });
  };
  const subscriptions = [];
  subscriptions.push(engine.on(ReplayEvents.STATE_CHANGED, (state) => {
    appState.setReplayState(state);
    if (state.currentIndex >= 0) timeline.setPosition(state.currentIndex);
    reportStatus();
  }));
  subscriptions.push(engine.on(ReplayEvents.STARTED, (payload) => {
    const idx = payload?.index ?? appState.pendingStartIndex;
    timeline.setPosition(idx);
    reveal(idx);
    reportStatus();
  }));
  for (const event of [ReplayEvents.STEPPED, ReplayEvents.SEEKED]) {
    subscriptions.push(engine.on(event, (payload) => {
      reportStatus();
      if (payload?.index !== undefined) reveal(payload.index);
    }));
  }
  subscriptions.push(engine.on(ReplayEvents.RESET, (state) => {
    if (state.status === 'ready') {
      coordinator.updatePreviewWindow(appState.pendingStartIndex);
      reveal(appState.pendingStartIndex);
      timeline.setTotal(candleStore.getCount(), candleStore.getAll());
    } else if (state.index !== undefined) reveal(state.index);
    reportStatus();
  }));
  return {
    reveal,
    destroy() {
      subscriptions.splice(0).forEach((unsubscribe) => { try { unsubscribe?.(); } catch (error) { console.warn('[ReplayLifecycle] unsubscribe failed', error); } });
    },
  };
}
