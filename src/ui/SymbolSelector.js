export class SymbolSelector {
  constructor(selectEl, appState, symbols = null) {
    this.el = selectEl;
    this.appState = appState;
    this.symbols = symbols ?? ['BTCUSD', 'BTCUSDT', 'ETHUSD', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
    this._render();
  }

  _render() {
    this.el.innerHTML = this.symbols.map(s => `<option value="${s}" ${s===this.appState.symbol?'selected':''}>${s}</option>`).join('');
  }
}
