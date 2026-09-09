import { describe, expect, it, vi } from 'vitest';
import { registerActionGuard } from '../../src/app/registerActionGuard.js';

describe('registerActionGuard', () => {
  it('allows actions when no position is open', () => {
    const register = vi.fn((guard) => guard('start'));
    const result = registerActionGuard({ registerActionGuard: register }, () => false, vi.fn());

    expect(result).toEqual({ allowed: true });
  });

  it('blocks load with the reset-specific message when a position is open', () => {
    const reportError = vi.fn();
    const register = vi.fn((guard) => guard('load'));

    const result = registerActionGuard({ registerActionGuard: register }, () => true, reportError);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Cannot load new data');
    expect(reportError).toHaveBeenCalledWith(result.reason);
  });
});
