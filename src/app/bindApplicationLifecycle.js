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
    win?.removeEventListener?.('pagehide', destroy);
    if (destroyed) return;
    destroyed = true;
    const cleanup = [
      ['keyboard cleanup', () => unbindKeyboardShortcuts?.()],
      ['application cleanup', () => onDestroy?.()],
      ['resource cleanup', () => resources.forEach((resource) => resource?.destroy?.())],
      ['extra cleanup', () => extraCleanup.forEach((cleanupFn) => cleanupFn?.())],
      ['engine cleanup', () => engine?.destroy?.()],
      ['cache cleanup', () => candleCache?.close?.()],
    ];
    for (const [label, fn] of cleanup) {
      try { fn(); } catch (error) { console.warn(`[App] ${label} failed`, error); }
    }
  };
  win?.addEventListener?.('pagehide', destroy, { once: true });
  return destroy;
}
