import assert from 'node:assert/strict';
import test from 'node:test';

import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../../src/ports/DataWorkspacePort.js';

function validPort() {
  return {
    snapshot: () => ({ count: 0 }),
    download: async () => undefined,
    importLocalDataset: async () => undefined,
    clearCurrent: async () => undefined,
    validateCurrent: async () => ({ status: 'empty' }),
    on: (event) => { return () => {}; },
    storageEstimate: async () => null,
    listDatasets: async () => [],
    listLocalDatasets: async () => [],
  };
}

test('data workspace port exposes the application-facing contract', () => {
  const port = validPort();
  assert.equal(assertDataWorkspacePort(port), port);
  assert.equal(DATA_WORKSPACE_EVENTS.PROGRESS, 'dataProgress');
  assert.equal(DATA_WORKSPACE_EVENTS.LOCAL_DATASET_CHANGED, 'localDatasetChanged');
  port.on(DATA_WORKSPACE_EVENTS.READY, () => {});
  port.on(DATA_WORKSPACE_EVENTS.LOCAL_DATASET_CHANGED, () => {});
});

test('data workspace port rejects incomplete adapters', () => {
  assert.throws(() => assertDataWorkspacePort({}), /requires snapshot/);
  assert.throws(() => assertDataWorkspacePort({ ...validPort(), importLocalDataset: undefined }), /requires importLocalDataset/);
});
