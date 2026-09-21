export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

const HEADER_CONTROL = Object.freeze({
  ready: { text: '▶ START REPLAY', label: 'Start replay' },
  playing: { text: '⏸ PAUSE', label: 'Pause replay' },
  paused: { text: '▶ RESUME', label: 'Resume replay' },
  ended: { text: '↺ REPLAY AGAIN', label: 'Replay again' },
});

export function createReplayCommandPolicy(tradingCapabilities = null) {
  return Object.freeze({
    canExecute(action) {
      if (action === 'reset' || action === 'restart' || action === 'stepForward' || action === 'resume' || action === 'seek' || action === 'setSpeed') return { allowed: true };
      const hasTradingActivity = Boolean(tradingCapabilities?.hasTradingActivity?.());
      if (action === 'start' && hasTradingActivity) {
        return { allowed: false, reason: 'Cannot start a new replay position after trading activity. Seek to the desired candle or reset the simulation first.' };
      }
      return { allowed: true };
    },
  });
}

export class ReplayCommandController {
  constructor({
    engine,
    appState,
    candleStore,
    onLoad = null,
    onPreview = null,
    onBeforeLoad = null,
    canExecute = null,
    tradingCapabilities = null,
    onError = null,
    headerBtn = null,
  }) {
    this.engine = engine;
    this.appState = appState;
    this.candleStore = candleStore;
    this.onLoad = onLoad;
    this.onPreview = onPreview;
    this.onBeforeLoad = onBeforeLoad;
    this.canExecute = canExecute || createReplayCommandPolicy(tradingCapabilities).canExecute;
    this.onError = onError;
    this.headerBtn = headerBtn;
    this.busy = false;
    this.destroyed = false;
    this.subscriptions = [];
    const on = engine?.on?.bind(engine);
    if (on) {
      for (const event of ['stateChanged', 'reset']) {
        const off = on(event, () => this.renderHeaderBtn());
        if (typeof off === 'function') this.subscriptions.push(off);
      }
    }
    if (headerBtn) {
      this.onHeaderClick = () => { void this.togglePlayPause(); };
      headerBtn.addEventListener('click', this.onHeaderClick);
    }
    this.renderHeaderBtn();
  }

  hasData() {
    return !this.destroyed && (this.candleStore?.getCount?.() || 0) > 0;
  }

  allowed(action) {
    if (this.destroyed || this.busy) return false;
    try {
      const result = this.canExecute(action);
      if (result?.allowed === false) {
        this.error(result.reason);
        return false;
      }
      return result !== false;
    } catch (e) {
      this.error(e?.message);
      return false;
    }
  }

  error(message) {
    if (!this.destroyed) this.onError?.(message);
  }

  async run(action) {
    if (this.destroyed || this.busy) return false;
    this.busy = true;
    try {
      await action();
      return true;
    } catch (e) {
      this.error(e?.message || 'Replay command failed');
      return false;
    } finally {
      this.busy = false;
    }
  }

  async loadReplay(options = {}) {
    if (this.destroyed) return false;
    await this.onBeforeLoad?.();
    return this.onLoad?.(options);
  }

  async togglePlayPause() {
    if (this.destroyed || this.busy) return false;
    if (!this.hasData()) {
      return this.run(() => this.loadReplay({ autoStart: true }));
    }
    const state = this.engine.getState();
    if (state.status === 'ready' || state.status === 'paused') {
      return this.allowed(state.status === 'ready' ? 'start' : 'resume')
        ? this.run(() => this.engine.play())
        : false;
    }
    if (state.status === 'playing') return this.run(() => this.engine.pause());
    if (state.status === 'ended') {
      return this.allowed('restart')
        ? this.run(async () => {
          const resetState = await this.engine.reset();
          const targetIndex = this.appState?.pendingStartIndex;
          if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < this.engine.getTotalCandles() && resetState.currentIndex !== targetIndex) {
            await this.engine.seek(targetIndex);
          }
          await this.engine.play();
        })
        : false;
    }
    return this.run(() => this.loadReplay({ autoStart: true }));
  }

  async startAt(index) {
    if (this.destroyed || this.busy) return false;
    const n = Number(index);
    if (!this.hasData() || !Number.isInteger(n) || n < 0 || n >= this.engine.getTotalCandles() || !this.allowed('start')) return false;
    return this.run(() => this.engine.start(n));
  }

  async stepForward() {
    if (this.destroyed || this.busy) return false;
    return this.hasData() && this.allowed('stepForward') ? this.run(() => this.engine.stepForward()) : false;
  }

  async stepBackward() {
    if (this.destroyed || this.busy) return false;
    const n = this.engine.getState().currentIndex - 1;
    return n >= 0 ? this.trySeek(n) : false;
  }

  async jumpBy(delta) {
    if (this.destroyed || this.busy) return false;
    const amount = Number(delta);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) return false;
    const s = this.engine.getState();
    const total = this.engine.getTotalCandles();
    if (!Number.isInteger(s.currentIndex) || total <= 0) return false;
    const n = Math.min(Math.max(0, s.currentIndex + amount), total - 1);
    return n === s.currentIndex ? false : this.trySeek(n);
  }

  cycleSpeed(direction = 1) {
    if (this.destroyed || this.busy) return null;
    const amount = Number(direction);
    if (!Number.isInteger(amount)) return null;
    try {
      const current = Number(this.engine.getState().speed || 1);
      let i = PLAYBACK_SPEEDS.indexOf(current);
      if (i < 0) i = PLAYBACK_SPEEDS.indexOf(1);
      return this.setSpeed(PLAYBACK_SPEEDS[Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, i + amount))]);
    } catch (e) {
      this.error(e?.message);
      return null;
    }
  }

  setSpeed(speed) {
    if (this.destroyed || this.busy || !this.hasData() || !this.allowed('setSpeed')) return false;
    const value = Number(speed);
    if (!PLAYBACK_SPEEDS.includes(value)) return false;
    try {
      return this.engine.setSpeed(value);
    } catch (e) {
      this.error(e?.message);
      return false;
    }
  }

  async pause() {
    if (this.destroyed || this.busy) return false;
    return this.engine.getState().status === 'playing' ? this.run(() => this.engine.pause()) : false;
  }

  async reset() {
    if (this.destroyed || this.busy || !this.hasData() || !this.allowed('reset')) return false;
    return this.run(async () => {
      const state = await this.engine.reset();
      if (state.status === 'ready') this.onPreview?.(state.startIndex);
    });
  }

  async trySeek(index) {
    if (this.destroyed || this.busy) return false;
    const n = Number(index);
    if (!this.hasData() || !Number.isInteger(n) || n < 0 || n >= this.engine.getTotalCandles() || !this.allowed('seek')) return false;
    return this.run(() => this.engine.seek(n));
  }

  renderHeaderBtn() {
    if (!this.headerBtn || this.destroyed) return;
    const status = this.engine.getState().status;
    const control = HEADER_CONTROL[status] || HEADER_CONTROL.ready;
    this.headerBtn.textContent = control.text;
    this.headerBtn.setAttribute('aria-label', control.label);
    this.headerBtn.setAttribute('aria-keyshortcuts', 'Space');
  }

  bindKeyboardShortcuts(target = globalThis.document) {
    if (!target?.addEventListener || this.destroyed) return () => {};
    const handler = e => {
      const tag = e.target?.tagName?.toUpperCase?.();
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      const f = e.code === 'Space'
        ? () => this.togglePlayPause()
        : e.code === 'ArrowRight'
          ? () => e.shiftKey ? this.jumpBy(10) : this.stepForward()
          : e.code === 'ArrowLeft'
            ? () => e.shiftKey ? this.jumpBy(-10) : this.stepBackward()
            : e.code === 'KeyR'
              ? () => this.reset()
              : e.code === 'Escape'
                ? () => this.pause()
                : null;
      if (f) { e.preventDefault(); void f(); }
      if (e.code === 'KeyZ') this.cycleSpeed(-1);
      if (e.code === 'KeyX') this.cycleSpeed(1);
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.headerBtn?.removeEventListener?.('click', this.onHeaderClick);
    this.subscriptions.splice(0).forEach(off => { try { off?.(); } catch {} });
    this.onLoad = null;
    this.onPreview = null;
    this.onBeforeLoad = null;
    this.onError = null;
  }
}
