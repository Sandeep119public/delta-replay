import { describe, expect, it, vi } from 'vitest';
import { bindApplicationLifecycle } from '../src/app/bindApplicationLifecycle.js';

describe('bindApplicationLifecycle', () => {
  it('executes function disposers and destroyable resources exactly once', () => {
    const disposer = vi.fn();
    const destroy = vi.fn();
    const lifecycle = bindApplicationLifecycle({
      unbindKeyboardShortcuts: vi.fn(),
      coordinator: { destroy: vi.fn() },
      engine: { destroy: vi.fn() },
      candleCache: { close: vi.fn() },
      resources: [disposer, { destroy }],
    });
    lifecycle();
    lifecycle();
    expect(disposer).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
