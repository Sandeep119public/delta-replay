/**
 * ChartAdapter bridges replay presentation state to ChartManager.
 * It consumes only the replay presentation port.
 */
export class ChartAdapter {
  constructor(replayPort, chartManager) {
    this.replayPort = replayPort;
    this.chart = chartManager;
    this._unsubs = [];
    this._lastRenderedIndex = -1;
    this._destroyed = false;
  }

  attach() {
    if (this._destroyed || !this.replayPort || !this.chart) return;
    this.detach();

    const render = (index, { fit = false } = {}) => {
      if (this._destroyed || !this.chart) return;
      const window = this.replayPort.getVisibleCandles?.() || [];
      if (!window.length) {
        this.chart.clear();
        this._lastRenderedIndex = -1;
        return;
      }
      this.chart.setRevealedMax?.(window[window.length - 1].time);
      this.chart.setData(window, { fit });
      if (!fit && this.chart.followCurrent) this.chart.followCurrent();
      this._lastRenderedIndex = index;
    };

    const subscriptions = [
      [this.replayPort.onStarted, ({ index }) => render(index, { fit: true })],
      [this.replayPort.onSeeked, ({ index }) => render(index, { fit: true })],
      [this.replayPort.onReset, (payload) => {
        const state = this.replayPort.getState();
        render(payload?.index ?? state.currentIndex, { fit: true });
      }],
      [this.replayPort.onStepped, ({ index }) => {
        if (index > this._lastRenderedIndex) render(index, { fit: false });
      }],
    ];

    for (const [subscribe, handler] of subscriptions) {
      const unsubscribe = typeof subscribe === 'function' ? subscribe(handler) : null;
      if (typeof unsubscribe === 'function') this._unsubs.push(unsubscribe);
    }
  }

  detach() {
    this._unsubs.forEach((unsubscribe) => {
      try { unsubscribe(); } catch {}
    });
    this._unsubs = [];
    this._lastRenderedIndex = -1;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.detach();
    this.replayPort = null;
    this.chart = null;
  }

  showPreview(targetIndex = null, windowSize = 1000) {
    if (this._destroyed || !this.chart || !this.replayPort) return;
    const count = this.replayPort.getTotalCandles?.() || 0;
    if (!count) return;
    const rawIndex = Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : count - 1;
    const index = Math.min(rawIndex, count - 1);
    const window = this.replayPort.getCandleWindow(index, windowSize);
    if (!window.length) return;
    this.chart.setRevealedMax?.(window[window.length - 1].time);
    this.chart.setData(window, { fit: true });
    this._lastRenderedIndex = -1;
  }
}
