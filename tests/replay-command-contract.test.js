import { describe, expect, it, vi } from 'vitest';
import { ReplayCommandController } from '../src/app/ReplayCommandController.js';

describe('ReplayCommandController', () => {
  it('does not issue overlapping replay commands', async () => {
    let resolveStep;
    const engine = {
      getState: () => ({ status: 'paused', currentIndex: 1, startIndex: 1, totalCandles: 3, speed: 1 }),
      getTotalCandles: () => 3,
      stepForward: vi.fn(() => new Promise((resolve) => { resolveStep = resolve; })),
      on: () => () => {},
      pause: vi.fn(async () => {}),
    };
    const controller = new ReplayCommandController({ engine, candleStore: { getCount: () => 3 }, appState: {}, onError: vi.fn() });
    const first = controller.stepForward();
    const second = controller.stepForward();
    expect(engine.stepForward).toHaveBeenCalledTimes(1);
    resolveStep?.();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    controller.destroy();
  });
});
