export class TimeframeSelector {
  constructor(selectEl, appState) {
    this.el = selectEl;
    this.appState = appState;
    this.timeframes = ['1m', '5m', '15m', '1h'];
    this._render();
    this.el.addEventListener('change', () => {
      this.appState.timeframe = this.el.value;
    });
  }

  _render() {
    this.el.innerHTML = this.timeframes.map(t => `<option value="${t}" ${t===this.appState.timeframe?'selected':''}>${t}</option>`).join('');
  }
}
