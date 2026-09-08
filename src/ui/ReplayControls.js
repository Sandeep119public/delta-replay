export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, replayPort, followBtn = null, onFollowClick = null }) {
    if (!replayPort) throw new TypeError('ReplayControls requires replayPort');
    this.playBtn = playBtn;
    this.pauseBtn = pauseBtn;
    this.stepBtn = stepBtn;
    this.resetBtn = resetBtn;
    this.startReplayBtn = startReplayBtn;
    this.speedSelect = speedSelect;
    this.statusEl = statusEl;
    this.replayPort = replayPort;
    this.followBtn = followBtn;
    this.onFollowClick = onFollowClick;
    this._listeners = [];
    this._subscriptions = [];
    this._pending = new Set();
    this._listen = (el, type, handler) => {
      el?.addEventListener?.(type, handler);
      if (el?.removeEventListener) this._listeners.push([el, type, handler]);
    };

    this._listen(this.playBtn, 'click', () => { void this._safeAction(() => this.replayPort.play()); });
    this._listen(this.pauseBtn, 'click', () => { void this._safeAction(() => this.replayPort.pause()); });
    this._listen(this.stepBtn, 'click', () => { void this._safeAction(() => this.replayPort.stepForward()); });
    this._listen(this.resetBtn, 'click', () => { void this._safeAction(() => this.replayPort.reset()); });
    this._listen(this.startReplayBtn, 'click', () => {
      const idx = Number(this.startReplayBtn.dataset.startIndex ?? '0');
      void this._safeAction(() => this.replayPort.start(idx));
    });
    this._listen(this.speedSelect, 'change', () => {
      void this._safeAction(() => this.replayPort.setSpeed(this.speedSelect.value), () => {
        this.speedSelect.value = String(this.replayPort.getState().speed);
      });
    });

    if (this.followBtn) this._listen(this.followBtn, 'click', () => {
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

  setStartIndex(idx) {
    const n = Number(idx);
    const total = this.replayPort.getTotalCandles?.() ?? this.replayPort.getState()?.totalCandles ?? 0;
    const valid = Number.isInteger(n) && n >= 0 && n < total;
    if (valid) {
      this.startReplayBtn.dataset.startIndex = String(n);
      this.startReplayBtn.disabled = false;
    } else {
      delete this.startReplayBtn.dataset.startIndex;
      this.startReplayBtn.disabled = true;
    }
    return valid;
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
      this.statusEl.className = `replay-status ${state.status}`;
    }
    try {
      document.body?.classList?.toggle('velocity-boost', Number(state.speed) >= 5);
    } catch {}

    this.startReplayBtn.disabled = !hasData || !isReady;
    this.startReplayBtn.textContent = isReady ? 'START REPLAY' : (isPlaying ? 'PAUSE' : isPaused ? 'RESUME' : isEnded ? 'REPLAY AGAIN' : 'START REPLAY');

    if (isPlaying) {
      this.playBtn.classList.add('hidden');
      this.pauseBtn.classList.remove('hidden');
      this.playBtn.disabled = true;
      this.pauseBtn.disabled = false;
    } else {
      this.playBtn.classList.remove('hidden');
      this.pauseBtn.classList.add('hidden');
      this.pauseBtn.disabled = true;
      this.playBtn.disabled = !isPaused;
    }

    this.stepBtn.disabled = !(isPaused && index < total - 1);
    this.resetBtn.disabled = !hasData || isIdle || isReady;
    this.speedSelect.disabled = !hasData || isIdle;

    if (isReady) {
      this.playBtn.disabled = true;
      this.pauseBtn.disabled = true;
      this.stepBtn.disabled = true;
    }
    if (isEnded) {
      this.playBtn.disabled = true;
      this.pauseBtn.disabled = true;
      this.stepBtn.disabled = true;
      this.resetBtn.disabled = state.startIndex < 0;
    }
  }

  setEnabledForPreview() {}

  setAutoFollow(isFollowing) {
    this.followBtn?.classList.toggle('hidden', isFollowing);
  }
}
