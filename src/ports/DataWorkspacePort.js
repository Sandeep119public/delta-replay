export const DATA_WORKSPACE_EVENTS = Object.freeze({
  LOADING_STARTED: 'dataLoadingStarted',
  PROGRESS: 'dataProgress',
  READY: 'dataReady',
  READY_DEGRADED: 'dataReadyDegraded',
  ERROR: 'dataError',
});

export function assertDataWorkspacePort(port) {
  const required = ['snapshot', 'download', 'clearCurrent', 'validateCurrent', 'on', 'storageEstimate'];
  for (const method of required) if (typeof port?.[method] !== 'function') throw new TypeError(`Data workspace port requires ${method}()`);
  return port;
}
