export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine, followBtn = null, onFollowClick = null }) {
    this.playBtn = playBtn;
    this.pauseBtn = pauseBtn;
    this.stepBtn = stepBtn;
    this.resetBtn = resetBtn;
    this.startReplayBtn = startReplayBtn;
    this.speedSelect = speedSelect;
    this.statusEl = statusEl;
    this.engine = engine;
    this.followBtn = followBtn;
    this.onFollowClick = onFollowClick;

    this._listeners = [];
    this._subscriptions = [];
    this._listen = (el, type, handler) => { el?.addEventListener?.(type, handler); this._listeners.push([el, type, handler]); };
    this._listen(this.playBtn, 'click', () => this._safeAction(() => this.engine.play()));
    this._listen(this.pauseBtn, 'click', () => this._safeAction(() => this.engine.pause()));
    this._listen(this.stepBtn, 'click', () => this._safeAction(() => this.engine.stepForward()));
    this._listen(this.resetBtn, 'click', () => this._safeAction(() => this.engine.reset()));
    this._listen(this.startReplayBtn, 'click', () => {
      const idx = Number(this.startReplayBtn.dataset.startIndex ?? '0');
      this._safeAction(() => this.engine.start(idx));
    });
    this._listen(this.speedSelect, 'change', () => {
      this._safeAction(() => this.engine.setSpeed(this.speedSelect.value), () => {
        this.speedSelect.value = String(this.engine.getState().speed);
      });
    });

    if (this.followBtn) {
      this._listen(this.followBtn, 'click', () => {
        if (this.onFollowClick) this.onFollowClick();
        this.followBtn.classList.add('hidden');
      });
    }

    this._subscriptions.push(this.engine.on('stateChanged', (state) => this.render(state)));
    this._subscriptions.push(this.engine.on('speedChanged', ({ speed }) => { this.speedSelect.value = String(speed); }));

    // Render immediately so the control state is correct even if the engine
    // was loaded before the controls were constructed.
    this.render(this.engine.getState());
  }

  destroy() { this._listeners.forEach(([el, type, handler]) => el?.removeEventListener?.(type, handler)); this._subscriptions.forEach((unsubscribe) => unsubscribe?.()); this._listeners = []; this._subscriptions = []; }

  _safeAction(action, onError = null) {
    try {
      return action();
    } catch (error) {
      console.warn('[ReplayControls]', error?.message || error);
      if (onError) onError(error);
      return this.engine.getState();
    }
  }

  setStartIndex(idx) {
    const n = Number(idx);
    const valid = Number.isInteger(n) && n >= 0 && n < this.engine.getTotalCandles();
    if (valid) {
      this.startReplayBtn.dataset.startIndex = String(n);
      this.startReplayBtn.disabled = false;
    } else {
      delete this.startReplayBtn.dataset.startIndex;
      this.startReplayBtn.disabled = true;
    }
  }

  render(state) {
    if (!state) return;

    const isIdle = state.status === 'idle';
    const isReady = state.status === 'ready';
    const isPlaying = state.status === 'playing';
    const isPaused = state.status === 'paused';
    const isEnded = state.status === 'ended';
    const hasData = state.totalCandles > 0;

    if (this.statusEl) {
      this.statusEl.textContent = state.status.toUpperCase();
      this.statusEl.className = `replay-status ${state.status}`;
    }

    // Velocity treatment: ambient momentum cue at 5x/10x (data never blurs)
    try {
      if (typeof document !== 'undefined' && document.body && document.body.classList) {
        document.body.classList.toggle('velocity-boost', Number(state.speed) >= 5);
      }
    } catch {}

    this.startReplayBtn.disabled = !hasData || !isReady;
    this.startReplayBtn.textContent = 'START REPLAY';

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

    this.stepBtn.disabled = !(isPaused && state.currentIndex < state.totalCandles - 1);
    this.resetBtn.disabled = !hasData || isIdle || isReady;
    this.speedSelect.disabled = !hasData || isIdle;

    // The start button is a pre-play control. PLAY/STEP become the active
    // controls only after a replay start event moves the engine to PAUSED.
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

  setEnabledForPreview() {
    // State-driven rendering handles preview/replay controls.
  }

  setAutoFollow(isFollowing) {
    if (this.followBtn) {
      this.followBtn.classList.toggle('hidden', isFollowing);
    }
  }
}
