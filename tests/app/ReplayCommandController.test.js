import { describe, expect, it, vi } from 'vitest';
import { createReplayCommandPolicy, ReplayCommandController } from '../../src/app/ReplayCommandController.js';

describe('ReplayCommandController', () => {
  it('allows deterministic seek but rejects a fresh start after trading activity', () => {
    const policy = createReplayCommandPolicy({ hasTradingActivity: () => true });

    expect(policy.canExecute('seek')).toEqual({ allowed: true });
    expect(policy.canExecute('start')).toEqual({
      allowed: false,
      reason: 'Cannot start a new replay position after trading activity. Seek to the desired candle or reset the simulation first.',
    });
    expect(policy.canExecute('reset')).toEqual({ allowed: true });
    expect(policy.canExecute('resume')).toEqual({ allowed: true });
  });

  it('replays again by seeking after reset instead of starting a new replay position', async () => {
    const reset = vi.fn(async () => ({ status: 'paused', currentIndex: 2 }));
    const seek = vi.fn(async () => ({ status: 'paused', currentIndex: 5 }));
    const play = vi.fn(async () => ({ status: 'playing', currentIndex: 5 }));
    const start = vi.fn();
    const engine = {
      getState: vi.fn(() => ({ status: 'ended', currentIndex: 9, speed: 1 })),
      getTotalCandles: () => 10,
      reset,
      seek,
      play,
      start,
    };
    const controller = new ReplayCommandController({
      engine,
      appState: { pendingStartIndex: 5 },
      candleStore: { getCount: () => 10 },
    });

    await expect(controller.togglePlayPause()).resolves.toBe(true);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(5);
    expect(play).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('sets only supported playback speeds and rejects arbitrary values', () => {
    const setSpeed = vi.fn((speed) => speed);
    const controller = new ReplayCommandController({
      engine: { getState: () => ({ status: 'ready', speed: 1 }), setSpeed },
      candleStore: { getCount: () => 1 },
    });

    expect(controller.setSpeed('5')).toBe(5);
    expect(controller.setSpeed('3')).toBe(false);
    expect(setSpeed).toHaveBeenCalledTimes(1);
    expect(setSpeed).toHaveBeenCalledWith(5);
  });

  it('does not change speed after destroy', () => {
    const setSpeed = vi.fn();
    const controller = new ReplayCommandController({
      engine: { getState: () => ({ status: 'ready', speed: 1 }), setSpeed },
      candleStore: { getCount: () => 1 },
    });

    controller.destroy();

    expect(controller.cycleSpeed(1)).toBeNull();
    expect(setSpeed).not.toHaveBeenCalled();
  });

  it('does not execute commands after destroy', async () => {
    const engine = {
      getState: vi.fn(() => ({ status: 'ready', currentIndex: 2, speed: 1 })),
      getTotalCandles: vi.fn(() => 5),
      start: vi.fn(), stepForward: vi.fn(), seek: vi.fn(), pause: vi.fn(), reset: vi.fn(), setSpeed: vi.fn(),
    };
    const controller = new ReplayCommandController({ engine, candleStore: { getCount: () => 5 } });

    controller.destroy();

    await expect(controller.startAt(2)).resolves.toBe(false);
    await expect(controller.stepForward()).resolves.toBe(false);
    await expect(controller.stepBackward()).resolves.toBe(false);
    await expect(controller.jumpBy(2)).resolves.toBe(false);
    await expect(controller.pause()).resolves.toBe(false);
    await expect(controller.reset()).resolves.toBe(false);
    await expect(controller.trySeek(2)).resolves.toBe(false);
    expect(engine.start).not.toHaveBeenCalled();
    expect(engine.stepForward).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.reset).not.toHaveBeenCalled();
    expect(engine.setSpeed).not.toHaveBeenCalled();
  });

  it('rejects non-finite or fractional jump distances', async () => {
    const seek = vi.fn();
    const controller = new ReplayCommandController({
      engine: { getState: () => ({ status: 'paused', currentIndex: 2, speed: 1 }), getTotalCandles: () => 5, seek },
      candleStore: { getCount: () => 5 },
    });

    await expect(controller.jumpBy(Number.NaN)).resolves.toBe(false);
    await expect(controller.jumpBy(Infinity)).resolves.toBe(false);
    await expect(controller.jumpBy(1.5)).resolves.toBe(false);
    expect(seek).not.toHaveBeenCalled();
  });

  it('does not change speed while another command is busy', async () => {
    let release;
    const setSpeed = vi.fn();
    const command = new Promise((resolve) => { release = resolve; });
    const controller = new ReplayCommandController({
      engine: {
        getState: () => ({ status: 'playing', speed: 1 }),
        pause: () => command,
        setSpeed,
      },
      candleStore: { getCount: () => 1 },
    });

    const pending = controller.pause();
    expect(controller.cycleSpeed(1)).toBeNull();
    expect(setSpeed).not.toHaveBeenCalled();

    release();
    await pending;
  });
});
