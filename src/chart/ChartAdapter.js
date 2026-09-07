import { ReplayEvents } from '../replay/ReplayEvents.js';

/**
 * ChartAdapter bridges replay presentation state to ChartManager.
 * It deliberately consumes only the narrow replay presentation port.
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

    const WINDOW = 1000;
    const visibleWindow = () => {
      if (this._destroyed || !this.replayPort) return [];
      const visible = this.replayPort.getVisibleCandles?.() || [];
      return visible.length > WINDOW ? visible.slice(-WINDOW) : visible;
    };

    const render = (index, { fit = false } = {}) => {
      if (this._destroyed || !this.chart) return;
      const window = visibleWindow();
      if (!window.length) {
        this.chart.clear();
        this._lastRenderedIndex = -1;
        return;
      }

      if (typeof this.chart.renderReplayWindow === 'function') {
        this.chart.renderReplayWindow(window, { fit });
      } else {
        this.chart.setRevealedMax?.(window[window.length - 1].time);
        this.chart.setData(window, { fit });
        if (!fit && this.chart.followCurrent) this.chart.followCurrent();
      }
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

  showPreview(candlesOrStore, targetIndex = null, windowSize = 1000) {
    if (this._destroyed || !this.chart || !candlesOrStore) return;
    let win;
    let revealedTime = null;

    if (typeof candlesOrStore.sliceWindow === 'function' && typeof candlesOrStore.getCount === 'function') {
      const count = candlesOrStore.getCount();
      if (!count) return;
      const idx = Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : count - 1;
      const start = Math.max(0, idx - windowSize + 1);
      win = candlesOrStore.sliceWindow(start, idx);
      revealedTime = candlesOrStore.get(idx)?.time ?? null;
    } else {
      const arr = Array.isArray(candlesOrStore) ? candlesOrStore : (candlesOrStore?.getAll?.() || []);
      if (!arr.length) return;
      const idx = Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : arr.length - 1;
      const start = Math.max(0, idx - windowSize + 1);
      win = arr.slice(start, idx + 1);
      revealedTime = win[win.length - 1]?.time ?? null;
    }

    this.chart.setRevealedMax?.(revealedTime);
    this.chart.setData(win, { fit: true });
    this._lastRenderedIndex = -1;
  }

  showPreviewWindow(candles, centerIdx, windowSize = 1000) {
    return this.showPreview(candles, centerIdx, windowSize);
  }
}
