import { DEFAULT_SYMBOLS } from '../ports/DatasetPresentationPort.js';
import { normalizeDatasetSource } from './presentationCompat.js';

export { DEFAULT_SYMBOLS };

export class SymbolSelector {
  constructor(selectEl, dataset = null, symbols = null) {
    if (!selectEl) throw new Error('SymbolSelector requires select element');
    this.el = selectEl;
    // dataset is a narrow view model ({ symbol }); legacy AppState is
    // normalized through presentationCompat so the UI never imports state.
    this.dataset = dataset;
    this.symbols = symbols ?? [...DEFAULT_SYMBOLS];
    this._onChange = null;
    this._handleChange = () => this._onChange?.(this.el.value);
    this._render();
    if (typeof this.el.addEventListener === 'function') this.el.addEventListener('change', this._handleChange);
  }

  get _selectedSymbol() {
    return normalizeDatasetSource(this.dataset, 'symbol');
  }

  _render() {
    const selected = this._selectedSymbol;
    if (typeof this.el.replaceChildren === 'function' && typeof document !== 'undefined') {
      this.el.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const symbol of this.symbols) {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        option.selected = symbol === selected;
        fragment.appendChild(option);
      }
      this.el.appendChild(fragment);
      return;
    }
    this.el.innerHTML = this.symbols
      .map(symbol => `<option value="${String(symbol).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }"${symbol === selected ? ' selected' : ''}>${String(symbol).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`)
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
