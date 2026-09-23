import { describe, expect, it, vi } from 'vitest';
import { createReplayCommandPolicy, ReplayCommandController } from '../../src/app/ReplayCommandController.js';

function engine(overrides = {}) {
  return {
    getTotalCandles: () => 10,
    getState: () => ({ status: 'ready', currentIndex: 2, speed: 1, startIndex: 1 }),
    on: () => () => {},
    ...overrides,
  };
}

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
    const controller = new ReplayCommandController({
      engine: engine({ getState: () => ({ status: 'ended', currentIndex: 9, speed: 1 }), reset, seek, play, start }),
      appState: { pendingStartIndex: 5 },
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
      engine: engine({ setSpeed, getState: () => ({ status: 'ready', speed: 1 }) }),
    });
    expect(controller.setSpeed('5')).toBe(5);
    expect(controller.setSpeed('3')).toBe(false);
    expect(setSpeed).toHaveBeenCalledTimes(1);
    expect(setSpeed).toHaveBeenCalledWith(5);
  });

  it('does not change speed after destroy', () => {
    const setSpeed = vi.fn();
    const controller = new ReplayCommandController({ engine: engine({ setSpeed }) });
    controller.destroy();
    expect(controller.cycleSpeed(1)).toBeNull();
    expect(setSpeed).not.toHaveBeenCalled();
  });

  it('does not execute commands after destroy', async () => {
    const e = engine({
      start: vi.fn(), stepForward: vi.fn(), seek: vi.fn(), pause: vi.fn(), reset: vi.fn(), setSpeed: vi.fn(),
    });
    const controller = new ReplayCommandController({ engine: e });
    controller.destroy();
    await expect(controller.startAt(2)).resolves.toBe(false);
    await expect(controller.stepForward()).resolves.toBe(false);
    await expect(controller.stepBackward()).resolves.toBe(false);
    await expect(controller.jumpBy(2)).resolves.toBe(false);
    await expect(controller.pause()).resolves.toBe(false);
    await expect(controller.reset()).resolves.toBe(false);
    await expect(controller.trySeek(2)).resolves.toBe(false);
    expect(e.start).not.toHaveBeenCalled();
    expect(e.stepForward).not.toHaveBeenCalled();
    expect(e.seek).not.toHaveBeenCalled();
    expect(e.pause).not.toHaveBeenCalled();
    expect(e.reset).not.toHaveBeenCalled();
    expect(e.setSpeed).not.toHaveBeenCalled();
  });

  it('rejects non-finite or fractional jump distances', async () => {
    const seek = vi.fn();
    const controller = new ReplayCommandController({ engine: engine({ getState: () => ({ status: 'paused', currentIndex: 2, speed: 1 }), seek }) });
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
      engine: engine({ getState: () => ({ status: 'playing', speed: 1 }), pause: () => command, setSpeed }),
    });
    const pending = controller.pause();
    expect(controller.cycleSpeed(1)).toBeNull();
    expect(setSpeed).not.toHaveBeenCalled();
    release();
    await pending;
  });
});
