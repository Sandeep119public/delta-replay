export function bindMobileDrawer() {
  const drawerBtn = document.getElementById('btn-trading-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const tradingPanelEl = document.getElementById('trading-panel');
  const setDrawer = (open) => {
    document.body.classList.toggle('drawer-open', !!open);
    drawerBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  drawerBtn?.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
  scrim?.addEventListener('click', () => setDrawer(false));
  if (!tradingPanelEl) return setDrawer;
  let swipeStartY = null;
  tradingPanelEl.addEventListener('touchstart', (e) => {
    const touch = e.touches?.[0];
    swipeStartY = Number.isFinite(touch?.clientY) ? touch.clientY : null;
  }, { passive: true });
  tradingPanelEl.addEventListener('touchend', (e) => {
    const touch = e.changedTouches?.[0];
    const endY = Number.isFinite(touch?.clientY) ? touch.clientY : null;
    const startY = swipeStartY;
    swipeStartY = null;
    if (endY !== null && startY !== null && endY - startY > 80 && document.body.classList.contains('drawer-open')) setDrawer(false);
  }, { passive: true });
  return setDrawer;
}
