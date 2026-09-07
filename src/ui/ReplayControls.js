import { ReplayEvents } from '../replay/ReplayEvents.js';

export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, replayPort, engine = null, followBtn = null, onFollowClick = null }) {
    this.playBtn = playBtn;
    this.pauseBtn = pauseBtn;
    this.stepBtn = stepBtn;
    this.resetBtn = resetBtn;
    this.startReplayBtn = startReplayBtn;
    this.speedSelect = speedSelect;
    this.statusEl = statusEl;
    this.replayPort = replayPort || engine;
    this.followBtn = followBtn;
    this.onFollowClick = onFollowClick;

    if (!this.replayPort) throw new TypeError('ReplayControls requires replayPort');

    this._listeners = [];
    this._subscriptions = [];
    this._listen = (el, type, handler) => {
      el?.addEventListener?.(type, handler);
      this._listeners.push([el, type, handler]);
    };

    this._listen(this.playBtn, 'click', () => this._safeAction(() => this.replayPort.play()));
    this._listen(this.pauseBtn, 'click', () => this._safeAction(() => this.replayPort.pause()));
    this._listen(this.stepBtn, 'click', () => this._safeAction(() => this.replayPort.stepForward()));
    this._listen(this.resetBtn, 'click', () => this._safeAction(() => this.replayPort.reset()));
    this._listen(this.startReplayBtn, 'click', () => {
      const idx = Number(this.startReplayBtn.dataset.startIndex ?? '0');
      this._safeAction(() => this.replayPort.start(idx));
    });
    this._listen(this.speedSelect, 'change', () => {
      this._safeAction(() => this.replayPort.setSpeed(this.speedSelect.value), () => {
        this.speedSelect.value = String(this.replayPort.getState().speed);
      });
    });

    if (this.followBtn) {
      this._listen(this.followBtn, 'click', () => {
        if (this.onFollowClick) this.onFollowClick();
        this.followBtn.classList.add('hidden');
      });
    }

    const onState = this.replayPort.onStateChanged || ((handler) => this.replayPort.on(ReplayEvents.STATE_CHANGED, handler));
    const onSpeed = this.replayPort.onSpeedChanged || ((handler) => this.replayPort.on(ReplayEvents.SPEED_CHANGED, handler));
    this._subscriptions.push(onState((state) => this.render(state)));
    this._subscriptions.push(onSpeed(({ speed }) => { this.speedSelect.value = String(speed); }));

    this.render(this.replayPort.getState());
  }

  destroy() {
    this._listeners.forEach(([el, type, handler]) => el?.removeEventListener?.(type, handler));
    this._subscriptions.forEach((unsubscribe) => { try { unsubscribe?.(); } catch {} });
    this._listeners = [];
    this._subscriptions = [];
    try { document?.body?.classList?.remove('velocity-boost'); } catch {}
  }

  _safeAction(action, onError = null) {
    try {
      return action();
    } catch (error) {
      console.warn('[ReplayControls]', error?.message || error);
      onError?.(error);
      return this.replayPort.getState();
    }
  }

  setStartIndex(idx) {
    const n = Number(idx);
    const valid = Number.isInteger(n) && n >= 0 && n < this.replayPort.getTotalCandles();
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

    try {
      if (typeof document !== 'undefined' && document.body?.classList) {
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
