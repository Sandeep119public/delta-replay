import { describe, expect, it, vi } from 'vitest';
import { ReplayEvents } from '../src/replay/ReplayEvents.js';
import { bindReplayLifecycle } from '../src/app/bindReplayLifecycle.js';

function createHarness() {
  const listeners = new Map();
  const engine = {
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
    emit(event, payload) { listeners.get(event)?.(payload); },
  };
  const appState = {
    pendingStartIndex: 2,
    setReplayState: vi.fn(),
  };
  const candleStore = {
    get: vi.fn((index) => ({ time: index * 100 })),
    getCount: vi.fn(() => 100),
    getAll: vi.fn(() => { throw new Error('reset must not enumerate candle store'); }),
  };
  const statusView = { snapshot: vi.fn(() => ({ status: 'ready' })) };
  const timeline = { setPosition: vi.fn(), setTotal: vi.fn() };
  const modeBanner = { update: vi.fn() };
  const preview = vi.fn();
  const chartManager = { setRevealedMax: vi.fn() };
  return { engine, appState, candleStore, statusView, timeline, modeBanner, preview, chartManager };
}

describe('Replay lifecycle presentation ownership', () => {
  it('renders status once from stateChanged and does not duplicate it from started/seeked/reset', () => {
    const h = createHarness();
    const binding = bindReplayLifecycle(h);

    h.engine.emit(ReplayEvents.STATE_CHANGED, { status: 'playing', currentIndex: 5 });
    h.engine.emit(ReplayEvents.STARTED, { index: 5 });
    h.engine.emit(ReplayEvents.SEEKED, { index: 7 });
    h.engine.emit(ReplayEvents.STEPPED, { index: 8 });

    expect(h.modeBanner.update).toHaveBeenCalledTimes(1);
    expect(h.appState.setReplayState).toHaveBeenCalledTimes(1);
    expect(h.timeline.setPosition).toHaveBeenCalledWith(5);
    expect(h.chartManager.setRevealedMax).toHaveBeenCalledTimes(3);
    binding.destroy();
  });

  it('reset previews and reveals without enumerating every candle', () => {
    const h = createHarness();
    const binding = bindReplayLifecycle(h);

    h.engine.emit(ReplayEvents.RESET, { status: 'ready' });

    expect(h.preview).toHaveBeenCalledWith(2);
    expect(h.chartManager.setRevealedMax).toHaveBeenCalledWith(200);
    expect(h.candleStore.getAll).not.toHaveBeenCalled();
    expect(h.timeline.setTotal).not.toHaveBeenCalled();
    expect(h.modeBanner.update).not.toHaveBeenCalled();
    binding.destroy();
  });
});
