import { INSTRUMENTS } from '../data/InstrumentConfig.js';

export const DEFAULT_SYMBOLS = Object.freeze([
  'BTCUSDT', 'BTCUSD', 'ETHUSDT', 'ETHUSD', 'SOLUSDT', 'XRPUSDT'
]);

export class SymbolSelector {
  constructor(selectEl, appState, symbols = null) {
    if (!selectEl) throw new Error('SymbolSelector requires select element');
    this.el = selectEl;
    this.appState = appState;
    this.symbols = symbols ?? [...DEFAULT_SYMBOLS];
    this._onChange = null;
    this._handleChange = () => this._onChange?.(this.el.value);
    this._render();
    if (typeof this.el.addEventListener === 'function') this.el.addEventListener('change', this._handleChange);
  }

  _render() {
    if (typeof this.el.replaceChildren === 'function' && typeof document !== 'undefined') {
      this.el.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const symbol of this.symbols) {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        option.selected = symbol === this.appState.symbol;
        fragment.appendChild(option);
      }
      this.el.appendChild(fragment);
      return;
    }
    this.el.innerHTML = this.symbols
      .map(symbol => `<option value="${String(symbol).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }"${symbol === this.appState.symbol ? ' selected' : ''}>${String(symbol).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`)
      .join('');
  }

  onChange(fn) {
    this._onChange = typeof fn === 'function' ? fn : null;
    return () => { if (this._onChange === fn) this._onChange = null; };
  }

  setSymbols(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('symbols must be a non-empty array');
    this.symbols = [...symbols];
    this._render();
  }

  destroy() {
    if (typeof this.el.removeEventListener === 'function') this.el.removeEventListener('change', this._handleChange);
    this._onChange = null;
  }
}
