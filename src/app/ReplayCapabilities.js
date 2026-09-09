/**
 * Stable application-facing replay capability bridge.
 * The composition root wires the coordinator; callers depend on this narrow contract.
 */
export function createReplayCapabilities() {
  let coordinator = null;
  return Object.freeze({
    capabilities: Object.freeze({
      load: (options = {}) => coordinator?.loadAndPrepareReplay(options),
      preview: (index) => coordinator?.updatePreviewWindow?.(index),
      changeDataset: (kind, value, sourceEl) => coordinator?.handleSymbolTimeframeChange(kind, value, sourceEl),
    }),
    attach(nextCoordinator) {
      coordinator = nextCoordinator;
    },
  });
}
