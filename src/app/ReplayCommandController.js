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
      if (['reset', 'restart', 'stepForward', 'resume', 'seek', 'setSpeed'].includes(action)) {
        return { allowed: true };
      }
      const hasTradingActivity = Boolean(tradingCapabilities?.hasTradingActivity?.());
      if (action === 'start' && hasTradingActivity) {
        return {
          allowed: false,
          reason: 'Cannot start a new replay position after trading activity. Seek to the desired candle or reset the simulation first.',
        };
      }
      return { allowed: true };
    },
  });
}

export class ReplayCommandController {
  constructor({ engine, appState, onLoad = null, onPreview = null, canExecute = null, tradingCapabilities = null, onError = null, headerBtn = null }) {
    if (!engine) throw new TypeError('ReplayCommandController requires engine');
    this.engine = engine;
    this.appState = appState;
    this.onLoad = onLoad;
    this.onPreview = onPreview;
    this.canExecute = canExecute || createReplayCommandPolicy(tradingCapabilities).canExecute;
    this.onError = onError;
    this.headerBtn = headerBtn;
    this.busy = false;
    this.destroyed = false;
    this.subscriptions = [];

    for (const event of ['stateChanged', 'reset']) {
      const off = engine.on?.(event, () => this.renderHeaderBtn());
      if (typeof off === 'function') this.subscriptions.push(off);
    }

    if (headerBtn) {
      this.onHeaderClick = () => { void this.togglePlayPause(); };
      headerBtn.addEventListener('click', this.onHeaderClick);
    }
    this.renderHeaderBtn();
  }

  hasData() { return !this.destroyed && this.engine.getTotalCandles() > 0; }

  allowed(action) {
    if (this.destroyed || this.busy) return false;
    try {
      const result = this.canExecute(action);
      if (result?.allowed === false) {
        this.error(result.reason);
        return false;
      }
      return result !== false;
    } catch (error) {
      this.error(error?.message);
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
    } catch (error) {
      this.error(error?.message || 'Replay command failed');
      return false;
    } finally {
      this.busy = false;
    }
  }

  async togglePlayPause() {
    if (this.destroyed || this.busy) return false;
    if (!this.hasData()) return this.run(() => this.onLoad?.({ autoStart: true }));

    const state = this.engine.getState();
    if (state.status === 'ready' || state.status === 'paused') {
      return this.allowed(state.status === 'ready' ? 'start' : 'resume')
        ? this.run(() => this.engine.play())
        : false;
    }
    if (state.status === 'playing') return this.run(() => this.engine.pause());

    if (state.status === 'ended') {
      return this.allowed('restart') ? this.run(async () => {
        const resetState = await this.engine.reset();
        const targetIndex = this.appState?.pendingStartIndex;
        if (
          Number.isInteger(targetIndex) &&
          targetIndex >= 0 &&
          targetIndex < this.engine.getTotalCandles() &&
          resetState.currentIndex !== targetIndex
        ) {
          await this.engine.seek(targetIndex);
        }
        await this.engine.play();
      }) : false;
    }
    return this.run(() => this.onLoad?.({ autoStart: true }));
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
    if (!Number.isInteger(amount)) return false;
    const state = this.engine.getState();
    const total = this.engine.getTotalCandles();
    if (!Number.isInteger(state.currentIndex) || total <= 0) return false;
    const n = Math.min(Math.max(0, state.currentIndex + amount), total - 1);
    return n === state.currentIndex ? false : this.trySeek(n);
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
    } catch (error) {
      this.error(error?.message);
      return null;
    }
  }

  async setSpeed(speed) {
    if (this.destroyed || this.busy || !this.hasData() || !this.allowed('setSpeed')) return false;
    const value = Number(speed);
    if (!PLAYBACK_SPEEDS.includes(value)) return false;
    return this.run(() => this.engine.setSpeed(value));
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
    const handler = (event) => {
      const tag = event.target?.tagName?.toUpperCase?.();
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;

      let action = null;
      if (event.code === 'Space') action = () => this.togglePlayPause();
      else if (event.code === 'ArrowRight') action = () => event.shiftKey ? this.jumpBy(10) : this.stepForward();
      else if (event.code === 'ArrowLeft') action = () => event.shiftKey ? this.jumpBy(-10) : this.stepBackward();
      else if (event.code === 'KeyR') action = () => this.reset();
      else if (event.code === 'Escape') action = () => this.pause();

      if (action) {
        event.preventDefault();
        void action();
      }
      if (event.code === 'KeyZ') this.cycleSpeed(-1);
      if (event.code === 'KeyX') this.cycleSpeed(1);
    };
    target.addEventListener('keydown', handler);
    return () => target.removeEventListener('keydown', handler);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.headerBtn?.removeEventListener?.('click', this.onHeaderClick);
    this.subscriptions.splice(0).forEach((off) => {
      try { off?.(); } catch {}
    });
    this.onLoad = null;
    this.onPreview = null;
    this.onError = null;
  }
}
