import assert from 'node:assert/strict';
import test from 'node:test';

import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../../src/ports/DataWorkspacePort.js';

test('data workspace port exposes the application-facing contract', () => {
  const calls = [];
  const port = {
    snapshot: () => ({ count: 0 }),
    download: async () => undefined,
    clearCurrent: async () => undefined,
    validateCurrent: async () => ({ status: 'empty' }),
    on: (event) => { calls.push(event); return () => {}; },
    storageEstimate: async () => null,
  };
  assert.equal(assertDataWorkspacePort(port), port);
  assert.equal(DATA_WORKSPACE_EVENTS.PROGRESS, 'dataProgress');
  port.on(DATA_WORKSPACE_EVENTS.READY, () => {});
  assert.deepEqual(calls, ['dataReady']);
});

test('data workspace port rejects incomplete adapters', () => {
  assert.throws(() => assertDataWorkspacePort({}), /requires snapshot/);
});
