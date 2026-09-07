/**
 * ReplayCommandController centralizes replay execution commands
 * (start, play, pause, step, reset, seek) across user interfaces.
 *
 * It owns replay commands only. Cross-service effects are injected as
 * callbacks, so the controller does not reach back into ReplayCoordinator
 * or trading-domain objects.
 */

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

export class ReplayCommandController {
  constructor({
    engine,
    appState,
    candleStore,
    onLoad = null,
    onPreview = null,
    canExecute = null,
    onError = null,
    headerBtn = null,
  }) {
    this.engine = engine;
    this.appState = appState;
    this.candleStore = candleStore;
    this.onLoad = typeof onLoad === 'function' ? onLoad : null;
    this.onPreview = typeof onPreview === 'function' ? onPreview : null;
    this.canExecute = typeof canExecute === 'function' ? canExecute : (() => true);
    this.onError = typeof onError === 'function' ? onError : null;
    this.headerBtn = headerBtn;
    this._subscriptions = [];
    this._destroyed = false;
    this._bindEngineEvents();
    this._bindHeaderBtn();
    this.renderHeaderBtn();
  }

  hasData() {
    return (this.candleStore?.getCount?.() || this.appState?.candles?.length || 0) > 0;
  }

  _load(autoStart = false) {
    if (this._destroyed) return false;
    return this.onLoad?.({ autoStart });
  }

  _preview(index) {
    if (this._destroyed) return false;
    return this.onPreview?.(index);
  }

  _allowed(action) {
    if (this._destroyed) return false;
    try {
      const result = this.canExecute(action);
      if (result === false) return false;
      if (result && typeof result === 'object' && result.allowed === false) {
        this._notifyError(result.reason || `Cannot ${action}`);
        return false;
      }
      return true;
    } catch (error) {
      this._notifyError(error?.message || `Cannot ${action}`);
      return false;
    }
  }

  togglePlayPause() {
    if (this._destroyed) return false;
    if (!this.hasData()) return this._load(true);
    const st = this.engine.getState();
    const startIndex = this.appState?.pendingStartIndex ?? 0;
    if (st.status === 'ready') {
      if (!this._allowed('start')) return false;
      this.engine.start(startIndex);
      this.engine.play();
    } else if (st.status === 'paused') {
      if (!this._allowed('resume')) return false;
      this.engine.play();
    } else if (st.status === 'playing') {
      this.engine.pause();
    } else if (st.status === 'ended') {
      if (!this._allowed('restart')) return false;
      this.engine.reset();
      this.engine.start(startIndex);
      this.engine.play();
    } else {
      return this._load(true);
    }
    return true;
  }

  startAt(idx) {
    if (this._destroyed || !this.hasData()) return false;
    const n = Number(idx);
    if (!Number.isFinite(n) || n < 0) return false;
    if (!this._allowed('start')) return false;
    try {
      this.engine.start(n);
      return true;
    } catch (e) {
      this._notifyError(e?.message || 'Cannot start replay here');
      return false;
    }
  }

  stepForward() {
    if (this._destroyed || !this.hasData()) return false;
    if (!this._allowed('stepForward')) return false;
    try {
      this.engine.stepForward();
      return true;
    } catch (e) {
      this._notifyError(e.message);
      return false;
    }
  }

  stepBackward() {
    if (this._destroyed || !this.hasData()) return false;
    const idx = this.engine.getState().currentIndex - 1;
    if (idx < 0) return false;
    return this.trySeek(idx);
  }

  jumpBy(delta) {
    if (this._destroyed || !this.hasData()) return false;
    const st = this.engine.getState();
    const total = this.engine.getTotalCandles?.() ?? this.candleStore?.getCount?.() ?? 0;
    if (!Number.isFinite(total) || total <= 0) return false;
    const idx = Math.min(Math.max(0, st.currentIndex + delta), total - 1);
    if (idx === st.currentIndex) return false;
    return this.trySeek(idx);
  }

  cycleSpeed(direction = 1) {
    if (this._destroyed) return null;
    try {
      const cur = Number(this.engine.getState().speed ?? 1);
      let i = PLAYBACK_SPEEDS.indexOf(cur);
      if (i === -1) i = PLAYBACK_SPEEDS.indexOf(1);
      const next = PLAYBACK_SPEEDS[Math.min(Math.max(0, i + direction), PLAYBACK_SPEEDS.length - 1)];
      this.engine.setSpeed(next);
      return next;
    } catch (e) {
      this._notifyError(e.message);
      return null;
    }
  }

  pause() {
    if (this._destroyed) return false;
    const s = this.engine.getState();
    if (s.status !== 'playing') return false;
    try {
      this.engine.pause();
      return true;
    } catch (e) {
      this._notifyError(e?.message || 'Unable to pause replay');
      return false;
    }
  }

  reset() {
    if (this._destroyed || !this.hasData()) return false;
    if (!this._allowed('reset')) return false;
    this.engine.reset();
    const st = this.engine.getState();
    if (st.status === 'ready') this._preview(st.startIndex ?? -1);
    this.renderHeaderBtn();
    return true;
  }

  trySeek(idx) {
    if (this._destroyed || !this._allowed('seek')) return false;
    try {
      this.engine.seek(idx);
      return true;
    } catch (e) {
      this._notifyError(e.message);
      return false;
    }
  }

  _notifyError(msg) {
    if (!this._destroyed && typeof this.onError === 'function') this.onError(msg);
  }

  _bindEngineEvents() {
    const subscribe = this.engine?.on?.bind(this.engine);
    if (typeof subscribe !== 'function') return;
    const stateUnsubscribe = subscribe('stateChanged', () => this.renderHeaderBtn());
    const resetUnsubscribe = subscribe('reset', () => this.renderHeaderBtn());
    if (typeof stateUnsubscribe === 'function') this._subscriptions.push(stateUnsubscribe);
    if (typeof resetUnsubscribe === 'function') this._subscriptions.push(resetUnsubscribe);
  }

  _bindHeaderBtn() {
    if (!this.headerBtn) return;
    this._onHeaderClick = () => this.togglePlayPause();
    this.headerBtn.addEventListener('click', this._onHeaderClick);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.headerBtn?.removeEventListener?.('click', this._onHeaderClick);
    this._subscriptions.splice(0).forEach((unsubscribe) => {
      try { unsubscribe?.(); } catch (error) { console.warn('[ReplayCommandController] unsubscribe failed', error); }
    });
    this._onHeaderClick = null;
    this.onLoad = null;
    this.onPreview = null;
    this.canExecute = () => false;
    this.onError = null;
  }

  renderHeaderBtn() {
    if (this._destroyed || !this.headerBtn) return;
    const s = this.engine.getState();
    if (s.status === 'ready') this.headerBtn.innerHTML = '<span class="icon">▶</span> START REPLAY';
    else if (s.status === 'playing') this.headerBtn.innerHTML = '<span class="icon">⏸</span> PAUSE';
    else if (s.status === 'paused') this.headerBtn.innerHTML = '<span class="icon">▶</span> RESUME';
    else if (s.status === 'ended') this.headerBtn.innerHTML = '<span class="icon">↺</span> REPLAY AGAIN';
  }

  bindKeyboardShortcuts(target = globalThis.document) {
    if (!target || typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function' || this._destroyed) return () => {};
    const handler = (e) => {
      if (this._destroyed) return;
      const tag = e.target?.tagName?.toUpperCase?.() || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ||
          (typeof HTMLInputElement !== 'undefined' && e.target instanceof HTMLInputElement) ||
          (typeof HTMLSelectElement !== 'undefined' && e.target instanceof HTMLSelectElement) ||
          (typeof HTMLTextAreaElement !== 'undefined' && e.target instanceof HTMLTextAreaElement)) return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlayPause(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) this.jumpBy(10); else this.stepForward(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) this.jumpBy(-10); else this.stepBackward(); }
      else if (e.code === 'KeyZ') { e.preventDefault(); this.cycleSpeed(-1); }
      else if (e.code === 'KeyX') { e.preventDefault(); this.cycleSpeed(1); }
      else if (e.code === 'KeyR') { e.preventDefault(); this.reset(); }
      else if (e.code === 'Escape') this.pause();
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  }
}