import { unixToDateTimeInput, toUnixSeconds } from '../utils/time.js';
import { resolvePresetTarget, resolveReplayTargetUnixSeconds } from '../utils/replayRange.js';
import { snapshotDataset } from '../ports/DatasetPresentationPort.js';
import { normalizeCandleSource } from './presentationCompat.js';

/**
 * ReplayDateSelector encapsulates replay date/time inputs, preset chips,
 * and the Jump-To-Candle dialog.
 *
 * Presentation contract: the selector receives narrow views and capability
 * callbacks — `dataset` ({ symbol, timeframe }), `candles`
 * ({ getCount, findIndexByTime }), `replay` (replay port), and
 * `onLoadReplay({ targetSec })`, `onPreviewWindow(index)`, `onSeek(index)`,
 * `onTimeframeChange(timeframe)` — never a coordinator, store, or command
 * controller. Engine-shaped candle sources are normalized through
 * presentationCompat.
 */
export class ReplayDateSelector {
  constructor({
    dataset = null,
    candles = null,
    replay = null,
    replayPort = null,
    onLoadReplay = null,
    onPreviewWindow = null,
    onSeek = null,
    onJump = null,
    onTimeframeChange = null,
    timeframeSelect = null,
    replayDateEl = (typeof document !== 'undefined' ? document.getElementById('replay-date') : null),
    replayTimeEl = (typeof document !== 'undefined' ? document.getElementById('replay-time') : null),
    jumpDateEl = (typeof document !== 'undefined' ? document.getElementById('jump-date') : null),
    jumpTimeEl = (typeof document !== 'undefined' ? document.getElementById('jump-time') : null),
    jumpBtn = (typeof document !== 'undefined' ? document.getElementById('jump-btn') : null),
    jumpErrorEl = (typeof document !== 'undefined' ? document.getElementById('jump-error') : null),
    presetChips = (typeof document !== 'undefined' ? document.querySelectorAll('.preset-chip') : []),
  } = {}) {
    this.dataset = dataset;
    this.candles = candles ? normalizeCandleSource(candles) : null;
    this.replayPort = replay ?? replayPort;
    this.onLoadReplay = onLoadReplay;
    this.onPreviewWindow = onPreviewWindow;
    this.onSeek = onSeek ?? onJump;
    this.onJump = this.onSeek;
    this.onTimeframeChange = onTimeframeChange;
    this.timeframeSelect = timeframeSelect || (typeof document !== 'undefined' ? document.getElementById('timeframe-select') : null);
    this.replayDateEl = replayDateEl;
    this.replayTimeEl = replayTimeEl;
    this.jumpDateEl = jumpDateEl;
    this.jumpTimeEl = jumpTimeEl;
    this.jumpBtn = jumpBtn;
    this.jumpErrorEl = jumpErrorEl;
    this.presetChips = presetChips;
    this.onJump = onJump;

    if (!this.replayPort) throw new TypeError('ReplayDateSelector requires replayPort');

    this._debounceTimer = null;
    this._handlers = [];

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

    const currentTimeframe = snapshotDataset(this.dataset).timeframe;
    const { targetSec, recommendedTimeframe } = resolvePresetTarget(presetKey, currentTimeframe);
    if (recommendedTimeframe !== currentTimeframe) {
      if (typeof this.onTimeframeChange === 'function') this.onTimeframeChange(recommendedTimeframe);
      if (this.timeframeSelect) this.timeframeSelect.value = recommendedTimeframe;
    }

    const dt = unixToDateTimeInput(targetSec);
    this.syncInputs(dt.date, dt.time);

    this.onLoadReplay?.({ targetSec, autoStart: false });
  }

  syncInputs(dateStr, timeStr) {
    if (this.replayDateEl) this.replayDateEl.value = dateStr;
    if (this.replayTimeEl) this.replayTimeEl.value = timeStr;
    if (this.jumpDateEl) this.jumpDateEl.value = dateStr;
    if (this.jumpTimeEl) this.jumpTimeEl.value = timeStr;
  }

  _bindEvents() {
    this.presetChips.forEach(chip => {
      const handler = () => this.selectPreset(chip.dataset.preset);
      chip.addEventListener('click', handler);
      this._handlers.push([chip, 'click', handler]);
    });
    const defaultChip = typeof document !== 'undefined' ? document.querySelector('.preset-chip[data-preset="1d"]') : null;
    if (defaultChip) defaultChip.classList.add('active');

    const handleInputChange = () => {
      this.presetChips.forEach(c => c.classList.remove('active'));
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        const targetSec = resolveReplayTargetUnixSeconds(this.replayDateEl?.value, this.replayTimeEl?.value);
        this.onLoadReplay?.({ targetSec, autoStart: false });
      }, 400);
    };

    if (this.replayDateEl) {
      this.replayDateEl.addEventListener('change', handleInputChange);
      this._handlers.push([this.replayDateEl, 'change', handleInputChange]);
    }
    if (this.replayTimeEl) {
      this.replayTimeEl.addEventListener('change', handleInputChange);
      this._handlers.push([this.replayTimeEl, 'change', handleInputChange]);
    }
    if (this.jumpBtn) {
      const handler = () => this.handleJump();
      this.jumpBtn.addEventListener('click', handler);
      this._handlers.push([this.jumpBtn, 'click', handler]);
    }
  }

  destroy() {
    clearTimeout(this._debounceTimer);
    this._handlers.forEach(([el, type, handler]) => el.removeEventListener?.(type, handler));
    this._handlers = [];
    this.replayPort = null;
    this.onLoadReplay = null;
    this.onPreviewWindow = null;
    this.onSeek = null;
    this.onJump = null;
    this.onTimeframeChange = null;
  }

  handleJump() {
    if (this.jumpErrorEl) {
      this.jumpErrorEl.classList.add('hidden');
      this.jumpErrorEl.textContent = '';
    }

    const total = this.candles?.getCount?.() || 0;
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

    const idx = this.candles.findIndexByTime(target);
    if (idx < 0) {
      this._showJumpError('No candle found for that time');
      return;
    }

    if (typeof this.onSeek === 'function') {
      this.onSeek(idx);
      return;
    }

    // No seek capability: only idle/ready preview navigation is possible.
    const st = this.replayPort.getState();
    if (st.status === 'idle' || st.status === 'ready') {
      this.onPreviewWindow?.(idx);
    } else {
      this._showJumpError('Seek is unavailable while replaying');
    }
  }

  _showJumpError(msg) {
    if (this.jumpErrorEl) {
      this.jumpErrorEl.textContent = msg;
      this.jumpErrorEl.classList.remove('hidden');
    }
  }
}
