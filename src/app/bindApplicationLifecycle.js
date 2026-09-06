export function bindApplicationLifecycle({ unbindKeyboardShortcuts, coordinator, engine, candleCache, resources = [], extraCleanup = [] }) {
  let destroyed = false;
  const destroy = () => {
    window.removeEventListener('pagehide', destroy);
    if (destroyed) return;
    destroyed = true;
    const cleanup = [
      ['keyboard cleanup', () => unbindKeyboardShortcuts?.()],
      ['coordinator cleanup', () => coordinator.destroy?.()],
      ['resource cleanup', () => resources.forEach((resource) => resource?.destroy?.())],
      ['extra cleanup', () => extraCleanup.forEach((cleanupFn) => cleanupFn?.())],
      ['engine cleanup', () => engine.destroy?.()],
      ['cache cleanup', () => candleCache.close?.()],
    ];
    for (const [label, fn] of cleanup) {
      try { fn(); } catch (error) { console.warn(`[App] ${label} failed`, error); }
    }
  };
  window.addEventListener('pagehide', destroy, { once: true });
  return destroy;
}
