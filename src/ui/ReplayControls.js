export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, speedSelect, statusEl, replayPort, commands, followBtn = null, onFollowClick = null }) {
    if (!replayPort || !commands) throw new TypeError('ReplayControls requires replay state and commands');
    this.commands = commands;
    this.playBtn = playBtn;
    this.pauseBtn = pauseBtn;
    this.stepBtn = stepBtn;
    this.resetBtn = resetBtn;
    this.speedSelect = speedSelect;
    this.statusEl = statusEl;
    this.replayPort = replayPort;
    this.followBtn = followBtn;
    this.onFollowClick = onFollowClick;
    this._listeners = [];
    this._subscriptions = [];

    const listen = (el, type, handler) => {
      el?.addEventListener?.(type, handler);
      if (el?.removeEventListener) this._listeners.push([el, type, handler]);
    };

    listen(this.playBtn, 'click', () => { void this._safeAction(() => this.commands.togglePlayPause()); });
    listen(this.pauseBtn, 'click', () => { void this._safeAction(() => this.commands.pause()); });
    listen(this.stepBtn, 'click', () => { void this._safeAction(() => this.commands.stepForward()); });
    listen(this.resetBtn, 'click', () => { void this._safeAction(() => this.commands.reset()); });
    listen(this.speedSelect, 'change', () => {
      void this._safeAction(() => this.commands.setSpeed(this.speedSelect.value), (error) => {
        if (this.speedSelect && error) this.speedSelect.value = String(this.replayPort.getState().speed);
      });
    });

    listen(this.followBtn, 'click', () => {
      if (!this.followBtn) return;
      this.onFollowClick?.();
      this.followBtn.classList.add('hidden');
    });

    const stateUnsubscribe = this.replayPort.onStateChanged((state) => this.render(state));
    const speedUnsubscribe = this.replayPort.onSpeedChanged((payload) => {
      const speed = typeof payload === 'object' ? payload.speed : payload;
      if (this.speedSelect) this.speedSelect.value = String(speed);
    });
    if (typeof stateUnsubscribe === 'function') this._subscriptions.push(stateUnsubscribe);
    if (typeof speedUnsubscribe === 'function') this._subscriptions.push(speedUnsubscribe);
    this.render(this.replayPort.getState());
  }

  destroy() {
    this._listeners.forEach(([el, type, handler]) => el?.removeEventListener?.(type, handler));
    this._subscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch {} });
    this._listeners = [];
    this._subscriptions = [];
    this.onFollowClick = null;
    this.commands = null;
  }

  async _safeAction(action, onError = null) {
    if (typeof action !== 'function') return null;
    try {
      const result = action();
      return result && typeof result.then === 'function' ? await result : result;
    } catch (error) {
      console.warn('[ReplayControls]', error?.message || error);
      onError?.(error);
      return this.replayPort.getState();
    }
  }

  render(state) {
    if (!state) return;
    const total = Number(state.totalCandles ?? state.total ?? 0);
    const index = Number(state.currentIndex ?? -1);
    const isIdle = state.status === 'idle';
    const isReady = state.status === 'ready';
    const isPlaying = state.status === 'playing';
    const isPaused = state.status === 'paused';
    const isEnded = state.status === 'ended';
    const hasData = total > 0;

    if (this.statusEl) {
      this.statusEl.textContent = String(state.status).toUpperCase();
      this.statusEl.className = 'replay-status ' + state.status;
    }
    try {
      document.body?.classList?.toggle('velocity-boost', Number(state.speed) >= 5);
    } catch {}

    if (this.playBtn) {
      this.playBtn.classList.toggle('hidden', isPlaying);
      this.playBtn.disabled = isPlaying || !hasData || isIdle;
    }
    if (this.pauseBtn) {
      this.pauseBtn.classList.toggle('hidden', !isPlaying);
      this.pauseBtn.disabled = !isPlaying;
    }
    if (this.stepBtn) this.stepBtn.disabled = !(isPaused && index < total - 1);
    if (this.resetBtn) this.resetBtn.disabled = !hasData || isIdle || isReady;
    if (this.speedSelect) this.speedSelect.disabled = !hasData || isIdle;

    if (isEnded) {
      if (this.playBtn) this.playBtn.disabled = !hasData;
      if (this.pauseBtn) this.pauseBtn.disabled = true;
      if (this.stepBtn) this.stepBtn.disabled = true;
      if (this.resetBtn) this.resetBtn.disabled = state.startIndex < 0;
    }
  }

  setEnabledForPreview(enabled = true) {
    const disabled = !enabled;
    [this.playBtn, this.pauseBtn, this.stepBtn, this.resetBtn, this.speedSelect]
      .forEach((element) => { if (element) element.disabled = disabled; });
  }

  setAutoFollow(isFollowing) {
    this.followBtn?.classList.toggle('hidden', isFollowing);
  }
}
