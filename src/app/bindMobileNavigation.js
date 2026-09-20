export function bindMobileNavigation({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const toggle = documentRef.getElementById('mobile-nav-toggle');
  const scrim = documentRef.getElementById('mobile-nav-scrim');
  const sidebar = documentRef.getElementById('app-sidebar');
  let previousFocus = null;

  const setOpen = (open) => {
    const isOpen = Boolean(open);
    if (isOpen && !documentRef.body.classList.contains('nav-open')) {
      previousFocus = documentRef.activeElement;
    }

    documentRef.body.classList.toggle('nav-open', isOpen);
    toggle?.setAttribute('aria-expanded', String(isOpen));
    toggle?.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    scrim?.setAttribute('aria-hidden', String(!isOpen));

    if (isOpen) {
      requestAnimationFrame(() => {
        sidebar?.querySelector('.nav-link.active, .nav-link')?.focus?.();
      });
    } else if (previousFocus?.focus) {
      requestAnimationFrame(() => previousFocus.focus());
      previousFocus = null;
    }
  };

  const onToggle = () => setOpen(!documentRef.body.classList.contains('nav-open'));
  const onScrim = () => setOpen(false);
  const onPageChange = () => setOpen(false);
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && documentRef.body.classList.contains('nav-open')) {
      event.preventDefault();
      setOpen(false);
    }
  };

  toggle?.addEventListener('click', onToggle);
  scrim?.addEventListener('click', onScrim);
  documentRef.addEventListener('keydown', onKeyDown);
  windowRef.addEventListener('pagechange', onPageChange);

  setOpen(false);

  return {
    setOpen,
    destroy() {
      toggle?.removeEventListener('click', onToggle);
      scrim?.removeEventListener('click', onScrim);
      documentRef.removeEventListener('keydown', onKeyDown);
      windowRef.removeEventListener('pagechange', onPageChange);
      setOpen(false);
    },
  };
}
