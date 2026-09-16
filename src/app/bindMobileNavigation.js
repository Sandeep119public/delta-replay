export function bindMobileNavigation({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const toggle = documentRef.getElementById('mobile-nav-toggle');
  const scrim = documentRef.getElementById('mobile-nav-scrim');
  const setOpen = (open) => {
    documentRef.body.classList.toggle('nav-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    toggle?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  const onToggle = () => setOpen(!documentRef.body.classList.contains('nav-open'));
  const onScrim = () => setOpen(false);
  const onPageChange = () => setOpen(false);

  toggle?.addEventListener('click', onToggle);
  scrim?.addEventListener('click', onScrim);
  windowRef.addEventListener('pagechange', onPageChange);

  return {
    destroy() {
      toggle?.removeEventListener('click', onToggle);
      scrim?.removeEventListener('click', onScrim);
      windowRef.removeEventListener('pagechange', onPageChange);
      setOpen(false);
    },
  };
}
