/**
 * Application event bridge. UI modules dispatch intent; application code owns effects.
 */
export function createApplicationActions({ coordinator, commandController, appState, engine, candleStore, modeBanner, timeline, controls, errorPanel }) {
  return {
    changeDataset(kind, value, sourceEl) {
      return coordinator.handleSymbolTimeframeChange(kind, value, sourceEl);
    },
    previewTimeline(index) {
      appState.setPendingStartIndex(index);
      controls.setStartIndex(index);
      modeBanner.update({ replayState: engine.getState(), appState, candleStore });
      const state = engine.getState();
      if (state.status === 'ready' || state.status === 'idle') coordinator.updatePreviewWindow(index);
    },
    commitTimeline(index) {
      const state = engine.getState();
      if (state.status === 'paused' || state.status === 'playing' || state.status === 'ended') {
        if (state.status === 'playing') commandController.pause();
        const ok = commandController.trySeek(index);
        if (!ok) timeline.setPosition(state.currentIndex);
        return;
      }
      appState.setPendingStartIndex(index);
      controls.setStartIndex(index);
      modeBanner.update({ replayState: state, appState, candleStore });
      coordinator.updatePreviewWindow(index);
    },
    startAt(index) {
      if (!Number.isFinite(Number(index)) || Number(index) < 0) return;
      appState.setPendingStartIndex(Number(index));
      controls.setStartIndex(Number(index));
      commandController.startAt(Number(index));
    },
    pause() { commandController.pause(); },
    handleLiquidation(payload) {
      try { commandController.pause(); } catch (error) { console.warn('[Replay] liquidation pause failed', error); }
      errorPanel.show({ category: 'LIQUIDATION', userMessage: `Position liquidated: ${payload?.symbol || ''} @ ${payload?.liquidationPrice ?? '—'}`, message: 'Position liquidated', code: 'LIQUIDATION', context: {} }, { severity: 'critical', onPause: () => commandController.pause() });
    },
    load() { return coordinator.loadAndPrepareReplay({ autoStart: false }); },
  };
}
