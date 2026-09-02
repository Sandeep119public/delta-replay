export class TimeframeSelector {
  constructor(selectEl, appState) {
    this.el = selectEl;
    this.appState = appState;
    this.timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
    this._render();
  }

  _render() {
    this.el.innerHTML = this.timeframes.map(t => `<option value="${t}" ${t===this.appState.timeframe?'selected':''}>${t}</option>`).join('');
  }
}
