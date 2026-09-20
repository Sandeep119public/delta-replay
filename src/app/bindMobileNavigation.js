export function bindMobileNavigation({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const toggle = documentRef.getElementById('mobile-nav-toggle');
  const scrim = documentRef.getElementById('mobile-nav-scrim');
  const sidebar = documentRef.getElementById('app-sidebar');
  let previousFocus = null;

  const isMobile = () => {
    try {
      return windowRef.matchMedia?.('(max-width: 640px)')?.matches ?? windowRef.innerWidth <= 640;
    } catch {
      return windowRef.innerWidth <= 640;
    }
  };

  const getFocusable = () => [...sidebar?.querySelectorAll?.(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) || []].filter((el) => !el.closest?.('[hidden], .hidden, .compat-control'));

  const setOpen = (open) => {
    const isOpen = Boolean(open);
    if (isOpen && !documentRef.body.classList.contains('nav-open')) {
      previousFocus = documentRef.activeElement;
    }

    documentRef.body.classList.toggle('nav-open', isOpen);
    toggle?.setAttribute('aria-expanded', String(isOpen));
    toggle?.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    scrim?.setAttribute('aria-hidden', String(!isOpen));
    if (sidebar) {
      if (isMobile()) sidebar.setAttribute('aria-hidden', String(!isOpen));
      else sidebar.removeAttribute('aria-hidden');
    }

    if (isOpen) {
      requestAnimationFrame(() => {
        sidebar?.querySelector('.nav-link.active, .nav-link')?.focus?.();
      });
    } else if (previousFocus?.focus) {
      const restore = previousFocus;
      previousFocus = null;
      requestAnimationFrame(() => restore.focus());
    }
  };

  const onToggle = () => setOpen(!documentRef.body.classList.contains('nav-open'));
  const onScrim = () => setOpen(false);
  const onPageChange = () => setOpen(false);
  const onKeyDown = (event) => {
    if (!documentRef.body.classList.contains('nav-open')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
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
