import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycleGuard } from '../../src/app/createLifecycleGuard.js';

test('starts only once and destroys only once', () => {
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

  assert.equal(starts, 1);
  assert.equal(destroys, 1);
  assert.equal(lifecycle.started, true);
  assert.equal(lifecycle.destroyed, true);
});

test('does not start after destroy', () => {
  let starts = 0;
  const lifecycle = createLifecycleGuard({
    start: () => { starts += 1; },
    destroy: () => {},
  });

  lifecycle.destroy();
  lifecycle.start();

  assert.equal(starts, 0);
});
