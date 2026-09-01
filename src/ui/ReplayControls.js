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

    this.playBtn.addEventListener('click', () => this.engine.play());
    this.pauseBtn.addEventListener('click', () => this.engine.pause());
    this.stepBtn.addEventListener('click', () => {
      try { this.engine.stepForward(); } catch (e) { console.warn(e.message); }
    });
    this.resetBtn.addEventListener('click', () => this.engine.reset());
    this.startReplayBtn.addEventListener('click', () => {
      const idx = Number(this.startReplayBtn.dataset.startIndex ?? '0');
      try { this.engine.start(idx); } catch (e) { console.error(e); }
    });
    this.speedSelect.addEventListener('change', () => {
      try { this.engine.setSpeed(this.speedSelect.value); } catch (e) { console.warn(e.message); this.speedSelect.value = this.engine.getState().speed; }
    });

    // engine state listener
    this.engine.on('stateChanged', (s) => this.render(s));
    this.engine.on('speedChanged', ({ speed }) => { this.speedSelect.value = String(speed); });
  }

  setStartIndex(idx) {
    this.startReplayBtn.dataset.startIndex = String(idx);
    this.startReplayBtn.disabled = false;
  }

  render(state) {
    if (!state) return;
    this.statusEl.textContent = state.status;
    this.statusEl.className = 'replay-status ' + state.status;

    const isIdle = state.status === 'idle';
    const isReady = state.status === 'ready';
    const isPlaying = state.status === 'playing';
    const isPaused = state.status === 'paused';
    const isEnded = state.status === 'ended';

    // play/pause toggle
    if (isPlaying) {
      this.playBtn.classList.add('hidden');
      this.pauseBtn.classList.remove('hidden');
      this.pauseBtn.disabled = false;
    } else {
      this.playBtn.classList.remove('hidden');
      this.pauseBtn.classList.add('hidden');
      this.playBtn.disabled = !(isPaused);
    }

    this.stepBtn.disabled = !(isPaused || isEnded) || (state.currentIndex >= state.totalCandles - 1 && isEnded);
    // Actually step disabled when ended at last candle
    if (isEnded && state.currentIndex >= state.totalCandles - 1) this.stepBtn.disabled = true;
    else if (isPaused) this.stepBtn.disabled = false;
    else if (isPlaying) this.stepBtn.disabled = true;

    this.resetBtn.disabled = isIdle || isReady;
    this.speedSelect.disabled = isIdle || isReady;
    this.playBtn.disabled = !(isPaused || isPlaying) ? true : (isPaused ? false : true);
    // When paused, play enabled. When playing, pause enabled (via toggle). Simplify:
    if (isPaused) { this.playBtn.disabled = false; }
    if (isPlaying) { this.pauseBtn.disabled = false; }
    if (isReady || isIdle) { this.playBtn.disabled = true; this.pauseBtn.disabled = true; }
  }

  setEnabledForPreview(enabled) {
    // before replay start, only START REPLAY enabled
    // handled via setStartIndex
  }
}
