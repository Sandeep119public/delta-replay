export class SymbolSelector {
  constructor(selectEl, appState) {
    this.el = selectEl;
    this.appState = appState;
    this.symbols = ['BTCUSD', 'ETHUSD'];
    this._render();
    this.el.addEventListener('change', () => {
      this.appState.symbol = this.el.value;
    });
  }

  _render() {
    this.el.innerHTML = this.symbols.map(s => `<option value="${s}" ${s===this.appState.symbol?'selected':''}>${s}</option>`).join('');
  }
}
