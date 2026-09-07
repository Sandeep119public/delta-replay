/**
 * Application intent bridge. Presentation dispatches intent; injected
 * capabilities own the concrete effects.
 */
export function createApplicationActions({
  replay,
  commandController,
  replayPort,
  appState,
  statusView,
  modeBanner,
  timeline,
  controls,
  errorPanel,
}) {
  if (!replay || typeof replay !== 'object') throw new TypeError('createApplicationActions requires replay capabilities');
  if (!commandController || typeof commandController !== 'object') throw new TypeError('createApplicationActions requires command capabilities');
  if (!replayPort || typeof replayPort.getState !== 'function') throw new TypeError('createApplicationActions requires replayPort');
  if (!statusView || typeof statusView.snapshot !== 'function') throw new TypeError('createApplicationActions requires statusView.snapshot()');
  if (!appState || !modeBanner || !timeline || !controls || !errorPanel) {
    throw new TypeError('createApplicationActions requires application presentation dependencies');
  }

  const reportStatus = () => modeBanner.update(statusView.snapshot());

  return Object.freeze({
    changeDataset(kind, value, sourceEl) {
      return replay.changeDataset(kind, value, sourceEl);
    },
    previewTimeline(index) {
      appState.setPendingStartIndex(index);
      controls.setStartIndex(index);
      reportStatus();
      const state = replayPort.getState();
      if (state.status === 'ready' || state.status === 'idle') replay.preview(index);
    },
    commitTimeline(index) {
      const state = replayPort.getState();
      if (state.status === 'paused' || state.status === 'playing' || state.status === 'ended') {
        if (state.status === 'playing') commandController.pause();
        const ok = commandController.trySeek(index);
        if (!ok) timeline.setPosition(state.currentIndex);
        return;
      }
      appState.setPendingStartIndex(index);
      controls.setStartIndex(index);
      reportStatus();
      replay.preview(index);
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
      errorPanel.show({
        category: 'LIQUIDATION',
        userMessage: `Position liquidated: ${payload?.symbol || ''} @ ${payload?.liquidationPrice ?? '—'}`,
        message: 'Position liquidated',
        code: 'LIQUIDATION',
        context: {},
      }, { severity: 'critical', onPause: () => commandController.pause() });
    },
    load() { return replay.load(); },
  });
}