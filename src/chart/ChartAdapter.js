/**
 * ChartAdapter bridges replay presentation state to ChartManager.
 * It deliberately consumes only the replay presentation port.
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

    const visibleWindow = () => {
      if (this._destroyed || !this.replayPort) return [];
      return this.replayPort.getVisibleCandles?.() || [];
    };

    const render = (index, { fit = false } = {}) => {
      if (this._destroyed || !this.chart) return;
      const window = visibleWindow();
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
      [this.replayPort.onReset, (payload) => render(payload?.index ?? this.replayPort.getState().currentIndex, { fit: true })],
      [this.replayPort.onStepped, ({ index }) => { if (index > this._lastRenderedIndex) render(index, { fit: false }); }],
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

  showPreview(candleStore, targetIndex = null, windowSize = 1000) {
    if (this._destroyed || !this.chart || !candleStore) return;
    const count = candleStore.getCount?.() || 0;
    if (!count) return;
    const rawIndex = Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : count - 1;
    const index = Math.min(rawIndex, count - 1);
    const start = Math.max(0, index - windowSize + 1);
    const window = candleStore.sliceWindow(start, index);
    this.chart.setRevealedMax?.(candleStore.get(index)?.time ?? null);
    this.chart.setData(window, { fit: true });
    this._lastRenderedIndex = -1;
  }
}
