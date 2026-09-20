import { formatTime } from '../utils/time.js';

export class Timeline {
  constructor({ sliderEl, startLabelEl, currentLabelEl, endLabelEl, indexLabelEl, timeLabelEl, startIndexLabelEl, startTimeLabelEl = null }) {
    if (!sliderEl) throw new TypeError('Timeline requires slider element');
    this.slider = sliderEl;
    this.startLabel = startLabelEl;
    this.currentLabel = currentLabelEl;
    this.endLabel = endLabelEl;
    this.indexLabel = indexLabelEl;
    this.timeLabel = timeLabelEl;
    this.startIndexLabel = startIndexLabelEl;
    this.startTimeLabelEl = startTimeLabelEl;
    this._total = 0;
    this._times = [];
    this._candles = [];
    this._onChange = null;
    this._onCommit = null;
    this._onStartHere = null;
    this._markers = [];
    this.markersEl = typeof document !== 'undefined' ? document.getElementById('timeline-markers') : null;
    this.startHereBtn = typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null;
    this._onInput = () => {
      const idx = this._clampIndex(this.slider.value);
      this.slider.value = String(idx);
      this._updateLabels(idx);
      this._onChange?.(idx);
    };
    this.slider.addEventListener('input', this._onInput);
    this._onCommitEvent = () => {
      const idx = this._clampIndex(this.slider.value);
      this.slider.value = String(idx);
      this._updateLabels(idx);
      this._onCommit?.(idx);
    };
    this.slider.addEventListener('change', this._onCommitEvent);
    this._onStartHereClick = null;
  }

  destroy() {
    this.slider?.removeEventListener?.('input', this._onInput);
    this.slider?.removeEventListener?.('change', this._onCommitEvent);
    if (this.startHereBtn && this._onStartHereClick) {
      this.startHereBtn.removeEventListener?.('click', this._onStartHereClick);
      delete this.startHereBtn.dataset.wired;
    }
    this._onChange = null;
    this._onCommit = null;
    this._onStartHere = null;
    this._onStartHereClick = null;
    this._markers = [];
    this._times = [];
    this._candles = [];
  }

  onChange(fn) { this._onChange = typeof fn === 'function' ? fn : null; }
  onCommit(fn) { this._onCommit = typeof fn === 'function' ? fn : null; }

  onStartHere(fn) {
    this._onStartHere = typeof fn === 'function' ? fn : null;
    const btn = this.startHereBtn || (typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null);
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      this.startHereBtn = btn;
      this._onStartHereClick = () => this._onStartHere?.(this.getSelectedIndex());
      btn.addEventListener('click', this._onStartHereClick);
    }
  }

  setMarkers(markers = []) {
    this._markers = Array.isArray(markers) ? markers : [];
    this._renderMarkers();
  }

  _renderMarkers() {
    const el = this.markersEl || (typeof document !== 'undefined' ? document.getElementById('timeline-markers') : null);
    if (!el) return;
    this.markersEl = el;
    while (el.firstChild) el.removeChild(el.firstChild);
    if (!this._total || !this._markers.length) return;
    const doc = el.ownerDocument || document;
    for (const marker of this._markers) {
      const rawIndex = Number(marker?.index);
      if (!Number.isFinite(rawIndex)) continue;
      const index = this._clampIndex(rawIndex);
      const pct = this._total > 1 ? (index / (this._total - 1)) * 100 : 0;
      const side = String(marker?.side ?? '').toUpperCase();
      const node = doc.createElement('span');
      node.className = `tl-marker ${side === 'SELL' || side === 'SHORT' ? 'is-short' : 'is-long'}`;
      node.style.left = `${pct}%`;
      node.title = `${side || 'TRADE'} @ #${index}`;
      node.setAttribute('aria-label', node.title);
      el.appendChild(node);
    }
  }

  setTotal(total, candles = null) {
    const numericTotal = Number(total);
    this._total = Number.isFinite(numericTotal) && numericTotal > 0 ? Math.floor(numericTotal) : 0;
    this._times = Array.isArray(candles) ? candles.slice(0, this._total).map((c) => c?.time) : [];
    this._candles = Array.isArray(candles) ? candles : [];
    if (this._total === 0) {
      this.slider.disabled = true;
      this.slider.min = '0';
      this.slider.max = '0';
      this.slider.value = '0';
      this._setText(this.startLabel, '—');
      this._setText(this.endLabel, '—');
      this._updateLabels(0);
      return;
    }
    this.slider.disabled = false;
    this.slider.min = '0';
    this.slider.max = String(this._total - 1);
    const initialIndex = this._clampIndex(Math.floor(this._total * 0.5));
    this.slider.value = String(initialIndex);
    const btn = this.startHereBtn || (typeof document !== 'undefined' ? document.getElementById('timeline-start-btn') : null);
    if (btn) btn.disabled = false;
    this._updateLabels(initialIndex);
    if (this._times.length) {
      this._setText(this.startLabel, formatTime(this._times[0]));
      this._setText(this.endLabel, formatTime(this._times[this._times.length - 1]));
    }
  }

  setPosition(index) {
    if (this._total === 0) return;
    const safeIndex = this._clampIndex(index);
    this.slider.value = String(safeIndex);
    this._updateLabels(safeIndex);
  }

  _clampIndex(index) {
    if (this._total <= 0) return 0;
    const numeric = Number(index);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(Math.max(Math.trunc(numeric), 0), this._total - 1);
  }

  _updateProgress(idx) {
    if (!this.slider?.style || typeof this.slider.style.setProperty !== 'function') return;
    const pct = this._total > 1 ? (idx / (this._total - 1)) * 100 : 0;
    this.slider.style.setProperty('--timeline-progress', `${pct}%`);
  }

  getSelectedIndex() { return this._clampIndex(this.slider.value); }

  setEnabled(enabled) { this.slider.disabled = !enabled || this._total === 0; }

  _setText(element, text) { if (element) element.textContent = String(text); }

  _updateLabels(index) {
    const idx = this._clampIndex(index);
    this._updateProgress(idx);
    const t = this._times[idx] ?? this._candles[idx]?.time;
    const timeStr = Number.isFinite(Number(t)) ? formatTime(t) : '—';
    this._setText(this.indexLabel, `${idx + 1} / ${this._total}`);
    this._setText(this.timeLabel, timeStr);
    this._setText(this.currentLabel, timeStr);
    this._setText(this.startIndexLabel, `Replay cursor: #${idx + 1} of ${this._total}`);
    if (this.startTimeLabelEl) this._setText(this.startTimeLabelEl, Number.isFinite(Number(t)) ? timeStr : '—');
    this._renderMarkers();
  }
}
