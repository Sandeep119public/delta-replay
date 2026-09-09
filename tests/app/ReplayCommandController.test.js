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
