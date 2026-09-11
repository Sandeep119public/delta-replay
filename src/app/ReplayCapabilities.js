/**
 * Stable application-facing replay capability bridge.
 * The composition root wires the coordinator; callers depend on this narrow contract.
 */

const unavailable = (operation) => ({
  success: false,
  code: 'REPLAY_CAPABILITY_UNAVAILABLE',
  message: `Replay capability is unavailable before coordinator attachment: ${operation}`,
});

export function createReplayCapabilities() {
  let coordinator = null;
  return Object.freeze({
    capabilities: Object.freeze({
      load: (options = {}) => coordinator
        ? coordinator.loadAndPrepareReplay(options)
        : Promise.resolve(unavailable('load')),
      preview: (index) => coordinator
        ? coordinator.updatePreviewWindow?.(index)
        : unavailable('preview'),
      changeDataset: (kind, value, sourceEl) => coordinator
        ? coordinator.handleSymbolTimeframeChange(kind, value, sourceEl)
        : unavailable('changeDataset'),
    }),
    attach(nextCoordinator) {
      if (!nextCoordinator || typeof nextCoordinator !== 'object') {
        throw new TypeError('Replay capability coordinator must be an object');
      }
      coordinator = nextCoordinator;
    },
  });
}
