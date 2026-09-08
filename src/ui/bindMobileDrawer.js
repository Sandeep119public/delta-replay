export function bindMobileDrawer() {
  const drawerBtn = document.getElementById('btn-trading-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const tradingPanelEl = document.getElementById('trading-panel');

  let previousFocus = null;
  const mobileQuery = window.matchMedia?.('(max-width: 1024px)');
  const isMobileDrawer = () => mobileQuery ? mobileQuery.matches : window.innerWidth <= 1024;

  const announce = (message) => { const live = document.getElementById('accessibility-live'); if (live) live.textContent = message; };
  const getFocusable = () => [...tradingPanelEl?.querySelectorAll?.('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []].filter((el) => !el.closest('[hidden], .hidden, .compat-control'));

  const setDrawer = (open) => {
    if (!isMobileDrawer()) {
      document.body.classList.remove('drawer-open');
      drawerBtn?.setAttribute('aria-expanded', 'false');
      scrim?.setAttribute('aria-hidden', 'true');
      tradingPanelEl?.removeAttribute('aria-hidden');
      return;
    }
    const isOpen = !!open;
    if (isOpen && !document.body.classList.contains('drawer-open')) previousFocus = document.activeElement;
    document.body.classList.toggle('drawer-open', isOpen);
    drawerBtn?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    scrim?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    tradingPanelEl?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (isOpen) { requestAnimationFrame(() => getFocusable()[0]?.focus?.()); announce('Trading panel opened'); }
    else { announce('Trading panel closed'); if (previousFocus?.focus) requestAnimationFrame(() => previousFocus.focus()); previousFocus = null; }
  };

  const onDrawerClick = () => { if (isMobileDrawer()) setDrawer(!document.body.classList.contains('drawer-open')); };
  const onScrimClick = () => { if (isMobileDrawer()) setDrawer(false); };
  const onViewportChange = () => setDrawer(false);
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) { event.preventDefault(); setDrawer(false); return; }
    if (event.key === 'Tab' && document.body.classList.contains('drawer-open')) { const focusable = getFocusable(); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  };

  drawerBtn?.addEventListener('click', onDrawerClick);
  scrim?.addEventListener('click', onScrimClick);
  document.addEventListener('keydown', onKeyDown);
  mobileQuery?.addEventListener?.('change', onViewportChange);

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
      mobileQuery?.removeEventListener?.('change', onViewportChange);
      tradingPanelEl?.removeEventListener('touchstart', onTouchStart);
      tradingPanelEl?.removeEventListener('touchend', onTouchEnd);
    },
  };
}
