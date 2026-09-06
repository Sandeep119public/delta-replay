import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimelineSparkline } from '../src/ui/TimelineSparkline.js';

function createCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    setTransform: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  };
}

function createCanvas(ctx) {
  const listeners = {};
  return {
    clientWidth: 300,
    width: 0,
    height: 0,
    parentElement: null,
    getContext: vi.fn(() => ctx),
    addEventListener: vi.fn((ev, fn) => { listeners[ev] = fn; }),
    removeEventListener: vi.fn((ev) => { delete listeners[ev]; }),
    getBoundingClientRect: () => ({ left: 0, width: 300 }),
    _listeners: listeners,
  };
}

const candles = Array.from({ length: 20 }, (_, i) => ({
  time: 1000 + i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 10,
}));

describe('TimelineSparkline', () => {
  let ctx;
  let canvas;
  let candleStore;
  let engine;
  let tradingEngine;

  beforeEach(() => {
    ctx = createCtx();
    canvas = createCanvas(ctx);
    candleStore = { getAll: vi.fn(() => candles) };
    engine = {
      getState: vi.fn(() => ({ status: 'paused', currentIndex: 10 })),
      on: vi.fn(),
      off: vi.fn(),
    };
    tradingEngine = { getTrades: vi.fn(() => []), on: vi.fn(), off: vi.fn() };
  });

  it('returns false without a canvas and true when empty', () => {
    const empty = new TimelineSparkline({ canvasEl: null, candleStore, engine, tradingEngine });
    expect(empty.render()).toBe(false);

    candleStore.getAll.mockReturnValue([]);
    const view = new TimelineSparkline({ canvasEl: canvas, candleStore, engine, tradingEngine });
    expect(view.render()).toBe(true);
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('draws the close-price sparkline and replay cursor', () => {
    const view = new TimelineSparkline({ canvasEl: canvas, candleStore, engine, tradingEngine });
    expect(view.render()).toBe(true);
    // sparkline path + cursor line both stroke
    expect(ctx.stroke.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('draws entry/exit pips for closed trades', () => {
    tradingEngine.getTrades.mockReturnValue([
      { side: 'LONG', entryPrice: 105, exitPrice: 110, openedAt: 1000 + 5 * 60, closedAt: 1000 + 10 * 60, netPnL: 5 },
      { side: 'SHORT', entryPrice: 115, exitPrice: 112, openedAt: 1000 + 12 * 60, closedAt: 1000 + 15 * 60, netPnL: -3 },
    ]);
    const view = new TimelineSparkline({ canvasEl: canvas, candleStore, engine, tradingEngine });
    view.render();
    // 2 entries (triangles via fill) + 2 exits (arcs)
    expect(ctx.arc.mock.calls.length).toBe(2);
    expect(ctx.fill.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('clicking the canvas seeks to the nearest candle index', () => {
    const onSeek = vi.fn();
    const view = new TimelineSparkline({ canvasEl: canvas, candleStore, engine, tradingEngine, onSeek });
    view._handleClick({ offsetX: 150 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    const idx = onSeek.mock.calls[0][0];
    // middle of 20 candles -> index ~9-10
    expect(idx).toBeGreaterThanOrEqual(9);
    expect(idx).toBeLessThanOrEqual(10);
  });

  it('subscribes to engine and trade events, and cleans up on destroy', () => {
    const view = new TimelineSparkline({ canvasEl: canvas, candleStore, engine, tradingEngine });
    expect(engine.on).toHaveBeenCalledWith('stateChanged', expect.any(Function));
    expect(tradingEngine.on).toHaveBeenCalledWith('tradeExecuted', expect.any(Function));
    view.destroy();
    expect(canvas.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });
});
