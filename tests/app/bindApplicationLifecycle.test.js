import { describe, expect, it, vi } from 'vitest';
import { bindApplicationLifecycle } from '../../src/app/bindApplicationLifecycle.js';

describe('bindApplicationLifecycle', () => {
  it('cleans resources once and in contract order', () => {
    const events = [];
    const win = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const destroy = bindApplicationLifecycle({
      unbindKeyboardShortcuts: () => events.push('keyboard'),
      onDestroy: () => events.push('application'),
      resources: [{ destroy: () => events.push('resource') }],
      extraCleanup: [() => events.push('extra')],
      engine: { destroy: () => events.push('engine') },
      candleCache: { close: () => events.push('cache') },
      win,
    });

    destroy();
    destroy();

    expect(events).toEqual(['keyboard', 'application', 'resource', 'extra', 'engine', 'cache']);
    expect(win.addEventListener).toHaveBeenCalledWith('pagehide', destroy, { once: true });
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('continues cleanup when one resource fails', () => {
    const events = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const destroy = bindApplicationLifecycle({
      resources: [
        { destroy: () => { events.push('first'); throw new Error('boom'); } },
        { destroy: () => events.push('second') },
      ],
      win: { addEventListener() {}, removeEventListener() {} },
    });

    destroy();

    expect(events).toEqual(['first', 'second']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('supports pagehide as the lifecycle trigger', () => {
    let pagehide;
    let destroys = 0;
    const win = {
      addEventListener: vi.fn((event, handler) => {
        if (event === 'pagehide') pagehide = handler;
      }),
      removeEventListener: vi.fn(),
    };

    bindApplicationLifecycle({
      onDestroy: () => { destroys += 1; },
      win,
    });

    pagehide();
    pagehide();

    expect(destroys).toBe(1);
    expect(win.removeEventListener).toHaveBeenCalledOnce();
  });
});
