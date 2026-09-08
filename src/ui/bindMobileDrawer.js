export function bindMobileDrawer() {
  const drawerBtn = document.getElementById('btn-trading-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const tradingPanelEl = document.getElementById('trading-panel');

  const setDrawer = (open) => {
    const isOpen = !!open;
    document.body.classList.toggle('drawer-open', isOpen);
    drawerBtn?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    scrim?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  };

  const onDrawerClick = () => setDrawer(!document.body.classList.contains('drawer-open'));
  const onScrimClick = () => setDrawer(false);
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false);
  };

  drawerBtn?.addEventListener('click', onDrawerClick);
  scrim?.addEventListener('click', onScrimClick);
  document.addEventListener('keydown', onKeyDown);

  let swipeStartY = null;
  const onTouchStart = (e) => {
    const touch = e.touches?.[0];
    swipeStartY = Number.isFinite(touch?.clientY) ? touch.clientY : null;
  };
  const onTouchEnd = (e) => {
    const touch = e.changedTouches?.[0];
    const endY = Number.isFinite(touch?.clientY) ? touch.clientY : null;
    const startY = swipeStartY;
    swipeStartY = null;
    if (endY !== null && startY !== null && endY - startY > 80 && document.body.classList.contains('drawer-open')) {
      setDrawer(false);
    }
  };

  tradingPanelEl?.addEventListener('touchstart', onTouchStart, { passive: true });
  tradingPanelEl?.addEventListener('touchend', onTouchEnd, { passive: true });

  setDrawer(false);

  return {
    setDrawer,
    destroy() {
      drawerBtn?.removeEventListener('click', onDrawerClick);
      scrim?.removeEventListener('click', onScrimClick);
      document.removeEventListener('keydown', onKeyDown);
      tradingPanelEl?.removeEventListener('touchstart', onTouchStart);
      tradingPanelEl?.removeEventListener('touchend', onTouchEnd);
    },
  };
}
