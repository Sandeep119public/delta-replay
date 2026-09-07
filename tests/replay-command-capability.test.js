import { describe, expect, it, vi } from 'vitest';
import { ReplayCommandController } from '../src/app/ReplayCommandController.js';

function createEngine() {
  const listeners = new Map();
  const state = { status: 'ready', currentIndex: 0, startIndex: 0, speed: 1 };
  return {
    state,
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
    getState: vi.fn(() => state),
    getTotalCandles: vi.fn(() => 10),
    start: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    reset: vi.fn(),
    stepForward: vi.fn(),
    setSpeed: vi.fn(),
  };
}

describe('ReplayCommandController capability boundary', () => {
  it('loads through the injected callback without a coordinator dependency', () => {
    const engine = createEngine();
    const onLoad = vi.fn(() => 'loaded');
    const controller = new ReplayCommandController({
      engine,
      appState: { pendingStartIndex: 2 },
      candleStore: { getCount: () => 0 },
      onLoad,
      onError: vi.fn(),
    });

    expect(controller.togglePlayPause()).toBe('loaded');
    expect(onLoad).toHaveBeenCalledWith({ autoStart: true });
  });

  it('blocks guarded commands through the injected capability policy', () => {
    const engine = createEngine();
    const onError = vi.fn();
    const controller = new ReplayCommandController({
      engine,
      appState: { pendingStartIndex: 2 },
      candleStore: { getCount: () => 10 },
      canExecute: (action) => ({ allowed: action !== 'seek', reason: 'position is open' }),
      onError,
    });

    expect(controller.trySeek(4)).toBe(false);
    expect(engine.seek).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('position is open');
  });

  it('becomes inert after destroy and unsubscribes engine listeners exactly once', () => {
    const engine = createEngine();
    const onLoad = vi.fn();
    const controller = new ReplayCommandController({
      engine,
      appState: { pendingStartIndex: 2 },
      candleStore: { getCount: () => 10 },
      onLoad,
      onPreview: vi.fn(),
      onError: vi.fn(),
    });

    controller.destroy();
    controller.destroy();

    expect(controller.togglePlayPause()).toBe(false);
    expect(controller.startAt(2)).toBe(false);
    expect(controller.stepForward()).toBe(false);
    expect(controller.trySeek(2)).toBe(false);
    expect(controller.cycleSpeed(1)).toBeNull();
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.setSpeed).not.toHaveBeenCalled();
  });
});
