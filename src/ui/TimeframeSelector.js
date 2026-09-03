import { TIMEFRAME_SECONDS } from '../data/DeltaCandleProvider.js';

export class TimeframeSelector {
  constructor(selectEl, appState, timeframes = null) {
    if (!selectEl) throw new Error('TimeframeSelector requires select element');
    this.el = selectEl;
    this.appState = appState;
    this.timeframes = timeframes ?? Object.keys(TIMEFRAME_SECONDS).filter(tf => tf !== '1w');
    this._onChange = null;
    this._handleChange = () => this._onChange?.(this.el.value);
    this._render();
    if (typeof this.el.addEventListener === 'function') this.el.addEventListener('change', this._handleChange);
  }

  _render() {
    if (typeof this.el.replaceChildren === 'function' && typeof document !== 'undefined') {
      this.el.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const timeframe of this.timeframes) {
        const option = document.createElement('option');
        option.value = timeframe;
        option.textContent = timeframe;
        option.selected = timeframe === this.appState.timeframe;
        fragment.appendChild(option);
      }
      this.el.appendChild(fragment);
      return;
    }
    this.el.innerHTML = this.timeframes
      .map(timeframe => `<option value="${String(timeframe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }"${timeframe === this.appState.timeframe ? ' selected' : ''}>${String(timeframe).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`)
      .join('');
  }

  onChange(fn) {
    this._onChange = typeof fn === 'function' ? fn : null;
    return () => { if (this._onChange === fn) this._onChange = null; };
  }

  setTimeframes(timeframes) {
    if (!Array.isArray(timeframes) || timeframes.length === 0) throw new Error('timeframes must be a non-empty array');
    this.timeframes = [...timeframes];
    this._render();
  }

  destroy() {
    if (typeof this.el.removeEventListener === 'function') this.el.removeEventListener('change', this._handleChange);
    this._onChange = null;
  }
}
