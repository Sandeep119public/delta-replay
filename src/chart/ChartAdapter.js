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

    const renderWindow = (index, { fit = false } = {}) => {
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

    const renderStep = (index) => {
      if (this._destroyed || !this.chart || index <= this._lastRenderedIndex) return;
      const candle = this.replayPort.getCandleWindow?.(index, 1)?.[0];
      if (!candle) {
        renderWindow(index, { fit: false });
        return;
      }
      const updated = this.chart.updateRevealedCandle?.(candle);
      if (!updated) {
        renderWindow(index, { fit: false });
        return;
      }
      this._lastRenderedIndex = index;
    };

    const subscriptions = [
      [this.replayPort.onStarted, ({ index }) => renderWindow(index, { fit: true })],
      [this.replayPort.onSeeked, ({ index }) => renderWindow(index, { fit: true })],
      [this.replayPort.onReset, (payload) => {
        const state = this.replayPort.getState();
        renderWindow(payload?.index ?? state.currentIndex, { fit: true });
      }],
      [this.replayPort.onStepped, ({ index }) => renderStep(index)],
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
    this._lastRenderedIndex = index;
  }
}
