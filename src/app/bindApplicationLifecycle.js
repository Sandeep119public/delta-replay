export function bindApplicationLifecycle({
  unbindKeyboardShortcuts,
  onDestroy,
  engine,
  candleCache,
  resources = [],
  extraCleanup = [],
  win = globalThis.window,
}) {
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    win?.removeEventListener?.('pagehide', destroy);

    const cleanup = [
      ['keyboard cleanup', () => unbindKeyboardShortcuts?.()],
      ['application cleanup', () => onDestroy?.()],
      ...resources.map((resource, index) => [
        `resource cleanup #${index + 1}`,
        () => resource?.destroy?.(),
      ]),
      ...extraCleanup.map((cleanupFn, index) => [
        `extra cleanup #${index + 1}`,
        () => cleanupFn?.(),
      ]),
      ['engine cleanup', () => engine?.destroy?.()],
      ['cache cleanup', () => candleCache?.close?.()],
    ];

    for (const [label, fn] of cleanup) {
      try {
        fn();
      } catch (error) {
        console.warn(`[App] ${label} failed`, error);
      }
    }
  };

  win?.addEventListener?.('pagehide', destroy, { once: true });
  return destroy;
}
