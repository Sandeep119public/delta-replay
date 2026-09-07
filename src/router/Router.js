/**
 * Browser page router.
 *
 * Browser globals are injected ({ win, doc }) so navigation is testable
 * without a real browser. When omitted they default to the live
 * globalThis.window / globalThis.document at call time.
 */
export class Router {
  constructor({ win = null, doc = null } = {}) {
    this.pages = new Map();
    this.currentPage = null;
    this.container = null;
    this._win = win;
    this._doc = doc;
  }

  get win() {
    return this._win ?? globalThis.window;
  }

  get doc() {
    return this._doc ?? globalThis.document;
  }

  register(name, component, options = {}) {
    this.pages.set(name, { component, options });
  }

  navigate(pageName) {
    const page = this.pages.get(pageName);
    if (!page) return;

    // Update URL hash without extra re-trigger if already there
    if (this.win.location.hash.slice(1) !== pageName) {
      this.win.location.hash = pageName;
    }

    // Hide all pages (specifically select .page elements to avoid hiding .nav-link)
    this.doc.querySelectorAll('.page[data-page], .page').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    // Show target page
    const pageEl = this.doc.getElementById(`page-${pageName}`);
    if (pageEl) {
      pageEl.classList.add('active', 'page-enter');
      pageEl.style.display = '';
      this.currentPage = pageName;

      // Update nav active state
      this.updateNav(pageName);

      // Dispatch custom event
      this.win.dispatchEvent(new CustomEvent('pagechange', { detail: { page: pageName } }));
    }
  }

  updateNav(pageName) {
    this.doc.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageName);
    });
  }

  onHashChange() {
    const hash = this.win.location.hash.slice(1) || 'replay';
    this.navigate(hash);
  }

  init() {
    // Handle hash changes
    this.win.addEventListener('hashchange', () => this.onHashChange());

    // Navigate to initial page
    const initial = this.win.location.hash.slice(1) || 'replay';
    this.navigate(initial);
  }
}

export const router = new Router();
