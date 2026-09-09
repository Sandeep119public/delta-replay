import { describe, expect, it, vi } from 'vitest';
import { ReplayCommandController } from '../../src/app/ReplayCommandController.js';

describe('ReplayCommandController', () => {
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
