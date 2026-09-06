/**
 * ReplayCommandController centralizes all replay execution commands
 * (start, play, pause, step, reset, seek) across user interfaces
 * (header button, replay bar, timeline slider, and keyboard shortcuts).
 *
 * Eliminates duplicate state machine checks and enforces unified execution guards.
 */
export class ReplayCommandController {
  constructor({
    engine,
    appState,
    candleStore,
    tradingEngine = null,
    coordinator = null,
    headerBtn = null,
    onError = null,
  }) {
    this.engine = engine;
    this.appState = appState;
    this.candleStore = candleStore;
    this.tradingEngine = tradingEngine;
    this.coordinator = coordinator;
    this.headerBtn = headerBtn;
    this.onError = onError;

    this._bindEngineEvents();
    this._bindHeaderBtn();
    this.renderHeaderBtn();
  }

  hasData() {
    return (this.candleStore?.getCount?.() || this.appState?.candles?.length || 0) > 0;
  }

  /**
   * Toggle between Play and Pause based on current engine state.
   * If not started yet, starts replay from pendingStartIndex.
   * If data is not yet loaded, delegates to coordinator to load and auto-start.
   */
  togglePlayPause() {
    if (!this.hasData()) {
      if (this.coordinator) {
        this.coordinator.loadAndPrepareReplay({ autoStart: true });
      }
      return;
    }

    const st = this.engine.getState();
    const startIndex = this.appState?.pendingStartIndex ?? 0;

    if (st.status === 'ready') {
      this.engine.start(startIndex);
      this.engine.play();
    } else if (st.status === 'paused') {
      this.engine.play();
    } else if (st.status === 'playing') {
      this.engine.pause();
    } else if (st.status === 'ended') {
      this.engine.reset();
      this.engine.start(startIndex);
      this.engine.play();
    } else if (this.coordinator) {
      this.coordinator.loadAndPrepareReplay({ autoStart: true });
    }
  }

  stepForward() {
    if (!this.hasData()) return false;
    try {
      this.engine.stepForward();
      return true;
    } catch (e) {
      this._notifyError(e.message);
      return false;
    }
  }

  pause() {
    const s = this.engine.getState();
    if (s.status === 'playing') {
      try {
        this.engine.pause();
        return true;
      } catch {}
    }
    return false;
  }

  reset() {
    if (!this.hasData()) return;
    this.engine.reset();
    const st = this.engine.getState();
    const startIndex = this.appState?.pendingStartIndex ?? 0;

    if (st.status === 'ready') {
      if (this.coordinator) {
        this.coordinator.updatePreviewWindow(startIndex);
      }
      this.renderHeaderBtn();
    }
  }

  trySeek(idx) {
    if (this.tradingEngine?.hasOpenPosition?.()) {
      const msg = 'Cannot seek while a position is open — close position first.';
      this._notifyError(msg);
      return false;
    }
    try {
      this.engine.seek(idx);
      return true;
    } catch (e) {
      this._notifyError(e.message);
      return false;
    }
  }

  _notifyError(msg) {
    if (typeof this.onError === 'function') {
      this.onError(msg);
    } else if (this.coordinator?.showTradingError) {
      this.coordinator.showTradingError(msg);
    }
  }

  _bindEngineEvents() {
    this.engine.on('stateChanged', () => this.renderHeaderBtn());
    this.engine.on('reset', () => this.renderHeaderBtn());
  }

  _bindHeaderBtn() {
    if (!this.headerBtn) return;
    this.headerBtn.addEventListener('click', () => this.togglePlayPause());
  }

  renderHeaderBtn() {
    if (!this.headerBtn) return;
    const s = this.engine.getState();

    if (s.status === 'ready') {
      this.headerBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
    } else if (s.status === 'playing') {
      this.headerBtn.innerHTML = '<span class="icon">⏸</span> PAUSE';
    } else if (s.status === 'paused') {
      this.headerBtn.innerHTML = '<span class="icon">▶</span> RESUME';
    } else if (s.status === 'ended') {
      this.headerBtn.innerHTML = '<span class="icon">↺</span> REPLAY AGAIN';
    }
  }

  /**
   * Bind global keyboard shortcuts (Space, ArrowRight, KeyR, Escape)
   */
  bindKeyboardShortcuts(target = document) {
    if (!target) return () => {};

    const handler = (e) => {
      const tag = e.target?.tagName?.toUpperCase?.() || '';
      if (
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        tag === 'TEXTAREA' ||
        (typeof HTMLInputElement !== 'undefined' && e.target instanceof HTMLInputElement) ||
        (typeof HTMLSelectElement !== 'undefined' && e.target instanceof HTMLSelectElement) ||
        (typeof HTMLTextAreaElement !== 'undefined' && e.target instanceof HTMLTextAreaElement)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.stepForward();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        this.reset();
      } else if (e.code === 'Escape') {
        this.pause();
      }
    };

    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  }
}
