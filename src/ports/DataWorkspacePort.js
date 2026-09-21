export const DATA_WORKSPACE_EVENTS = Object.freeze({
  LOADING_STARTED: 'dataLoadingStarted',
  PROGRESS: 'dataProgress',
  READY: 'dataReady',
  READY_DEGRADED: 'dataReadyDegraded',
  ERROR: 'dataError',
  LOCAL_DATASET_CHANGED: 'localDatasetChanged',
});

export function assertDataWorkspacePort(port) {
  const required = ['snapshot', 'download', 'importLocalDataset', 'clearCurrent', 'validateCurrent', 'on', 'storageEstimate', 'listDatasets', 'listLocalDatasets'];
  for (const method of required) if (typeof port?.[method] !== 'function') throw new TypeError(`Data workspace port requires ${method}()`);
  return port;
}
