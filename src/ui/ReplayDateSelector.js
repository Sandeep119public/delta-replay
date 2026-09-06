import { unixToDateTimeInput, toUnixSeconds } from '../utils/time.js';
import { resolvePresetTarget, resolveReplayTargetUnixSeconds } from '../utils/replayRange.js';

/**
 * ReplayDateSelector encapsulates replay date/time inputs, preset chips,
 * and the Jump-To-Candle dialog.
 */
export class ReplayDateSelector {
  constructor({
    appState,
    coordinator,
    candleStore,
    engine,
    commandController = null,
    timeframeSelect = null,
    replayDateEl = (typeof document !== 'undefined' ? document.getElementById('replay-date') : null),
    replayTimeEl = (typeof document !== 'undefined' ? document.getElementById('replay-time') : null),
    jumpDateEl = (typeof document !== 'undefined' ? document.getElementById('jump-date') : null),
    jumpTimeEl = (typeof document !== 'undefined' ? document.getElementById('jump-time') : null),
    jumpBtn = (typeof document !== 'undefined' ? document.getElementById('jump-btn') : null),
    jumpErrorEl = (typeof document !== 'undefined' ? document.getElementById('jump-error') : null),
    presetChips = (typeof document !== 'undefined' ? document.querySelectorAll('.preset-chip') : []),
    onJump = null,
  } = {}) {
    this.appState = appState;
    this.coordinator = coordinator;
    this.candleStore = candleStore;
    this.engine = engine;
    this.commandController = commandController;
    this.timeframeSelect = timeframeSelect || (typeof document !== 'undefined' ? document.getElementById('timeframe-select') : null);
    this.replayDateEl = replayDateEl;
    this.replayTimeEl = replayTimeEl;
    this.jumpDateEl = jumpDateEl;
    this.jumpTimeEl = jumpTimeEl;
    this.jumpBtn = jumpBtn;
    this.jumpErrorEl = jumpErrorEl;
    this.presetChips = presetChips;
    this.onJump = onJump;

    this._debounceTimer = null;

    this.initDefaultRange();
    this._bindEvents();
  }

  initDefaultRange() {
    const nowSec = Math.floor(Date.now() / 1000);
    const toSec = Math.floor(nowSec / 60) * 60;
    const replaySec = toSec - 86400;
    const replayInput = unixToDateTimeInput(replaySec);

    if (this.replayDateEl) {
      this.replayDateEl.value = replayInput.date;
      if (this.replayTimeEl) this.replayTimeEl.value = replayInput.time;
      this.replayDateEl.min = '2020-01-01';
      this.replayDateEl.max = new Date(toSec * 1000).toISOString().slice(0, 10);
    }
    if (this.jumpDateEl) {
      this.jumpDateEl.value = replayInput.date;
      if (this.jumpTimeEl) this.jumpTimeEl.value = replayInput.time;
    }
  }

  selectPreset(presetKey) {
    this.presetChips.forEach(chip => {
      if (chip.dataset?.preset === presetKey) chip.classList.add('active');
      else chip.classList.remove('active');
    });

    const { targetSec, recommendedTimeframe } = resolvePresetTarget(presetKey, this.appState.timeframe);
    if (recommendedTimeframe !== this.appState.timeframe && this.timeframeSelect) {
      this.timeframeSelect.value = recommendedTimeframe;
      this.appState.timeframe = recommendedTimeframe;
    }

    const dt = unixToDateTimeInput(targetSec);
    this.syncInputs(dt.date, dt.time);

    this.coordinator.loadAndPrepareReplay({ targetSec, autoStart: false });
  }

  syncInputs(dateStr, timeStr) {
    if (this.replayDateEl) this.replayDateEl.value = dateStr;
    if (this.replayTimeEl) this.replayTimeEl.value = timeStr;
    if (this.jumpDateEl) this.jumpDateEl.value = dateStr;
    if (this.jumpTimeEl) this.jumpTimeEl.value = timeStr;
  }

  _bindEvents() {
    this.presetChips.forEach(chip => {
      chip.addEventListener('click', () => this.selectPreset(chip.dataset.preset));
    });
    const defaultChip = typeof document !== 'undefined' ? document.querySelector('.preset-chip[data-preset="1d"]') : null;
    if (defaultChip) defaultChip.classList.add('active');

    const handleInputChange = () => {
      this.presetChips.forEach(c => c.classList.remove('active'));
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        const targetSec = resolveReplayTargetUnixSeconds(this.replayDateEl?.value, this.replayTimeEl?.value);
        this.coordinator.loadAndPrepareReplay({ targetSec, autoStart: false });
      }, 400);
    };

    if (this.replayDateEl) this.replayDateEl.addEventListener('change', handleInputChange);
    if (this.replayTimeEl) this.replayTimeEl.addEventListener('change', handleInputChange);

    if (this.jumpBtn) {
      this.jumpBtn.addEventListener('click', () => this.handleJump());
    }
  }

  handleJump() {
    if (this.jumpErrorEl) {
      this.jumpErrorEl.classList.add('hidden');
      this.jumpErrorEl.textContent = '';
    }

    const total = this.candleStore?.getCount?.() || this.appState?.candles?.length || 0;
    if (!total) {
      this._showJumpError('Load data first');
      return;
    }
    if (!this.jumpDateEl?.value) {
      this._showJumpError('Select date');
      return;
    }

    let target;
    try {
      target = toUnixSeconds(this.jumpDateEl.value, this.jumpTimeEl?.value || '00:00');
    } catch (e) {
      this._showJumpError(e.message);
      return;
    }

    const idx = this.candleStore.findIndexByTime(target);
    if (idx < 0) {
      this._showJumpError('No candle found for that time');
      return;
    }

    if (typeof this.onJump === 'function') {
      this.onJump(idx);
      return;
    }

    const st = this.engine.getState();
    if (st.status === 'idle' || st.status === 'ready') {
      this.appState.setPendingStartIndex(idx);
      this.coordinator?.updatePreviewWindow?.(idx);
    } else if (st.status === 'playing') {
      this.commandController?.pause?.();
      this.commandController?.trySeek?.(idx);
    } else if (st.status === 'paused' || st.status === 'ended') {
      this.commandController?.trySeek?.(idx);
    }
  }

  _showJumpError(msg) {
    if (this.jumpErrorEl) {
      this.jumpErrorEl.textContent = msg;
      this.jumpErrorEl.classList.remove('hidden');
    }
  }
}
