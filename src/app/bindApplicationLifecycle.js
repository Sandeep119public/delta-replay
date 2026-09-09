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
      ['resource cleanup', () => {
        for (const resource of resources) {
          try {
            resource?.destroy?.();
          } catch (error) {
            console.warn('[App] resource cleanup failed', error);
          }
        }
      }],
      ['extra cleanup', () => {
        for (const cleanupFn of extraCleanup) {
          try {
            cleanupFn?.();
          } catch (error) {
            console.warn('[App] extra cleanup failed', error);
          }
        }
      }],
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
