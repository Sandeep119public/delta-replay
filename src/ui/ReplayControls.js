export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, engine }) {
    this.playBtn = playBtn;
    this.pauseBtn = pauseBtn;
    this.stepBtn = stepBtn;
    this.resetBtn = resetBtn;
    this.startReplayBtn = startReplayBtn;
    this.speedSelect = speedSelect;
    this.statusEl = statusEl;
    this.engine = engine;

    this.playBtn.addEventListener('click', () => this._safeAction(() => this.engine.play()));
    this.pauseBtn.addEventListener('click', () => this._safeAction(() => this.engine.pause()));
    this.stepBtn.addEventListener('click', () => this._safeAction(() => this.engine.stepForward()));
    this.resetBtn.addEventListener('click', () => this._safeAction(() => this.engine.reset()));
    this.startReplayBtn.addEventListener('click', () => {
      const idx = Number(this.startReplayBtn.dataset.startIndex ?? '0');
      this._safeAction(() => this.engine.start(idx));
    });
    this.speedSelect.addEventListener('change', () => {
      this._safeAction(() => this.engine.setSpeed(this.speedSelect.value), () => {
        this.speedSelect.value = String(this.engine.getState().speed);
      });
    });

    this.engine.on('stateChanged', (state) => this.render(state));
    this.engine.on('speedChanged', ({ speed }) => { this.speedSelect.value = String(speed); });

    // Render immediately so the control state is correct even if the engine
    // was loaded before the controls were constructed.
    this.render(this.engine.getState());
  }

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

    this.statusEl.textContent = state.status.toUpperCase();
    this.statusEl.className = `replay-status ${state.status}`;

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
}
