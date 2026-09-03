export class SymbolSelector {
  constructor(selectEl, appState, symbols = null) {
    if (!selectEl) throw new Error('SymbolSelector requires select element');
    this.el = selectEl;
    this.appState = appState;
    this.symbols = symbols ?? ['BTCUSDT', 'BTCUSD', 'ETHUSDT', 'ETHUSD', 'SOLUSDT', 'XRPUSDT'];
    this._onChange = null;
    this._handleChange = () => {
      this.appState.symbol = this.el.value;
      this._onChange?.(this.el.value);
    };
    this._render();
    this.el.addEventListener('change', this._handleChange);
  }

  _render() {
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
  }

  onChange(fn) {
    this._onChange = typeof fn === 'function' ? fn : null;
    return () => {
      if (this._onChange === fn) this._onChange = null;
    };
  }

  setSymbols(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('symbols must be a non-empty array');
    this.symbols = [...symbols];
    this._render();
  }

  destroy() {
    this.el.removeEventListener('change', this._handleChange);
    this._onChange = null;
  }
}
