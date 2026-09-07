export function bindReplayLifecycle({
  engine,
  appState,
  candleStore,
  statusView,
  timeline,
  modeBanner,
  preview,
  chartManager,
}) {
  if (!engine || !appState || !candleStore || !statusView || !timeline || !modeBanner || !chartManager) {
    throw new TypeError('bindReplayLifecycle requires engine, appState, candleStore, statusView, timeline, mode banner, and chart dependencies');
  }
  if (typeof preview !== 'function') {
    throw new TypeError('bindReplayLifecycle requires preview(index) capability');
  }
  if (typeof statusView.snapshot !== 'function') {
    throw new TypeError('bindReplayLifecycle requires statusView.snapshot()');
  }

  const reveal = (idx) => {
    const candle = candleStore.get(idx);
    if (candle) chartManager.setRevealedMax(candle.time);
  };
  const reportStatus = () => modeBanner.update(statusView.snapshot());
  const subscriptions = [];

  // stateChanged is the single status-render authority. Other lifecycle
  // events update only the UI details that are unique to those events.
  subscriptions.push(engine.on('stateChanged', (state) => {
    appState.setReplayState(state);
    if (state.currentIndex >= 0) timeline.setPosition(state.currentIndex);
    reportStatus();
  }));

  subscriptions.push(engine.on('started', (payload) => {
    const idx = payload?.index ?? appState.pendingStartIndex;
    timeline.setPosition(idx);
    reveal(idx);
  }));

  for (const event of ['stepped', 'seeked']) {
    subscriptions.push(engine.on(event, (payload) => {
      if (payload?.index !== undefined) reveal(payload.index);
    }));
  }

  subscriptions.push(engine.on('reset', (state) => {
    if (state.status === 'ready') {
      preview(appState.pendingStartIndex);
      reveal(appState.pendingStartIndex);
    } else if (state.index !== undefined) {
      reveal(state.index);
    }
  }));

  return {
    reveal,
    destroy() {
      subscriptions.splice(0).forEach((unsubscribe) => {
        try { unsubscribe?.(); } catch (error) { console.warn('[ReplayLifecycle] unsubscribe failed', error); }
      });
    },
  };
}
