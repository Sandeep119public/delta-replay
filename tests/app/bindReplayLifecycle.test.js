import { describe, expect, it, vi } from 'vitest';
import { bindReplayLifecycle } from '../../src/app/bindReplayLifecycle.js';

function createHarness() {
  const listeners = new Map();
  const engine = {
    on(event, handler) {
      const set = listeners.get(event) || new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
    },
  };
  const candles = Array.from({ length: 12 }, (_, index) => ({ time: 1000 + index }));
  const appState = {
    pendingStartIndex: 3,
    setReplayState: vi.fn(),
  };
  const candleStore = { get: vi.fn((index) => candles[index]) };
  const statusView = { snapshot: vi.fn(() => ({ status: 'ready' })) };
  const timeline = { setPosition: vi.fn() };
  const modeBanner = { update: vi.fn() };
  const chartManager = { setRevealedMax: vi.fn() };
  const preview = vi.fn();

  const binding = bindReplayLifecycle({
    engine,
    appState,
    candleStore,
    statusView,
    timeline,
    modeBanner,
    preview,
    chartManager,
  });

  return { engine, appState, candleStore, timeline, chartManager, preview, binding };
}

describe('bindReplayLifecycle', () => {
  it('uses the replay event state when handling the reset lifecycle payload', () => {
    const { engine, preview, chartManager, candleStore } = createHarness();

    engine.emit('reset', {
      index: 7,
      state: { status: 'ready', startIndex: 4 },
    });

    expect(preview).toHaveBeenCalledWith(4);
    expect(candleStore.get).toHaveBeenCalledWith(4);
    expect(chartManager.setRevealedMax).toHaveBeenCalledWith(1004);
  });

  it('still reveals a non-ready reset payload at its reported index', () => {
    const { engine, preview, chartManager } = createHarness();

    engine.emit('reset', {
      index: 6,
      state: { status: 'paused', currentIndex: 6 },
    });

    expect(preview).not.toHaveBeenCalled();
    expect(chartManager.setRevealedMax).toHaveBeenCalledWith(1006);
  });

  it('unsubscribes all replay lifecycle listeners on destroy', () => {
    const { engine, binding, preview } = createHarness();

    binding.destroy();
    engine.emit('reset', { index: 2, state: { status: 'ready', startIndex: 2 } });

    expect(preview).not.toHaveBeenCalled();
  });
});
