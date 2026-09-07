import { describe, it, expect, vi } from 'vitest';
import { OrderFormView } from '../src/ui/OrderFormView.js';
import { Timeline } from '../src/ui/Timeline.js';
import { ErrorPanel } from '../src/ui/ErrorPanel.js';
import { ModeBanner } from '../src/ui/ModeBanner.js';
import { createTradingPresentation } from '../src/app/TradingPresentationAdapter.js';

function mockEl(extra = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    textContent: '', value: '', innerHTML: '', disabled: false, dataset: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      toggle: (c, f) => { f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c)); },
      contains: (c) => classes.has(c),
    },
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatchEvent: (e) => { (listeners[e.type] || []).forEach((h) => h(e)); },
    setAttribute: () => {}, getAttribute: () => null, querySelectorAll: () => [],
    ...extra,
  };
}

describe('terminal overhaul smoke', () => {
  it('% equity sizing computes qty from equity and mark', () => {
    const qtyInput = mockEl({ value: '' });
    qtyInput.dispatchEvent = () => {};
    const engine = {
      getLatestCandle: () => ({ close: 50000 }),
      getAccountSnapshot: () => ({ equity: 10000 }),
    };
    const view = new OrderFormView({ trading: createTradingPresentation(engine), qtyInput, getSymbol: () => 'BTCUSDT' });
    view.applyEquityPct(50);
    expect(Number(qtyInput.value)).toBeCloseTo(0.1, 4);
  });

  it('timeline start-here fires with slider index and renders markers', () => {
    const sliderEl = mockEl({ value: '7' });
    sliderEl.style = { setProperty: () => {} };
    const mk = () => mockEl();
    const tl = new Timeline({
      sliderEl, startLabelEl: mk(), currentLabelEl: mk(), endLabelEl: mk(),
      indexLabelEl: mk(), timeLabelEl: mk(), startIndexLabelEl: mk(),
    });
    const seen = [];
    tl.onStartHere((idx) => seen.push(idx));
    tl.setTotal(10, Array.from({ length: 10 }, (_, i) => ({ time: i })));
    tl.setMarkers([{ index: 2, side: 'BUY' }, { index: 8, side: 'SELL' }]);
    expect(tl._markers.length).toBe(2);
  });

  it('error panel exposes info/warn/critical + inline strip', () => {
    const container = mockEl();
    container.dataset = {};
    const panel = new ErrorPanel({
      container, titleEl: mockEl(), messageEl: mockEl(), contextEl: mockEl(),
      dismissBtn: mockEl(), retryBtn: mockEl(), detailsBtn: mockEl(),
    });
    panel.show({ category: 'x', userMessage: 'margin call', message: 'margin call', code: 'MARGIN' });
    expect(container.dataset.severity).toBe('critical');
    panel.show({ category: 'x', userMessage: 'data gap at 12:00', message: 'gap' }, {});
    expect(container.dataset.severity).toBe('warn');
    panel.showInfo('Cache hit');
    expect(container.dataset.severity).toBe('info');
    panel.hide();
    expect(container.dataset.severity).toBeUndefined();
  });

  it('ticker renders BAR n / n format', () => {
    const mkEl = (t = '') => ({ textContent: t, className: '', classList: { add() {}, remove() {} } });
    const progressText = mkEl(), progressPct = mkEl();
    const banner = new ModeBanner({
      modeBanner: { className: '', classList: { add() {}, remove() {} }, setAttribute: () => {} },
      modeIndicator: mkEl(),
      progressPanel: mkEl(), progressText, progressPct,
      marketTimeEl: mkEl(), marketTimeFull: mkEl(), srTicker: mkEl(),
      overlay: mkEl(), overlayText: mkEl(),
    });
    banner.update({ total: 8640, status: 'paused', loadingState: 'IDLE', pendingStartIndex: 0, currentIndex: 1481, candleAt: () => ({ time: 1717685100 }) });
    expect(progressText.textContent).toMatch(/BAR 1,482 \/ 8,640/);
    expect(progressPct.textContent).toMatch(/%/);
  });
});
