import { describe, expect, it } from 'vitest';
import { createLifecycleGuard } from '../../src/app/createLifecycleGuard.js';

describe('createLifecycleGuard', () => {
  it('starts only once and destroys only once', () => {
    let starts = 0;
    let destroys = 0;
    const lifecycle = createLifecycleGuard({
      start: () => { starts += 1; },
      destroy: () => { destroys += 1; },
    });

    lifecycle.start();
    lifecycle.start();
    lifecycle.destroy();
    lifecycle.destroy();

    expect(starts).toBe(1);
    expect(destroys).toBe(1);
    expect(lifecycle.started).toBe(true);
    expect(lifecycle.destroyed).toBe(true);
  });

  it('does not start after destroy', () => {
    let starts = 0;
    const lifecycle = createLifecycleGuard({
      start: () => { starts += 1; },
      destroy: () => {},
    });

    lifecycle.destroy();
    lifecycle.start();

    expect(starts).toBe(0);
  });
});
