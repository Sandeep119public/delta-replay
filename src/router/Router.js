export class Router {
  constructor() {
    this.pages = new Map();
    this.currentPage = null;
    this.container = null;
  }

  register(name, component, options = {}) {
    this.pages.set(name, { component, options });
  }

  navigate(pageName) {
    const page = this.pages.get(pageName);
    if (!page) return;

    // Update URL hash without extra re-trigger if already there
    if (window.location.hash.slice(1) !== pageName) {
      window.location.hash = pageName;
    }

    // Hide all pages (specifically select .page elements to avoid hiding .nav-link)
    document.querySelectorAll('.page[data-page], .page').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    // Show target page
    const pageEl = document.getElementById(`page-${pageName}`);
    if (pageEl) {
      pageEl.classList.add('active', 'page-enter');
      pageEl.style.display = '';
      this.currentPage = pageName;
      
      // Update nav active state
      this.updateNav(pageName);
      
      // Dispatch custom event
      window.dispatchEvent(new CustomEvent('pagechange', { detail: { page: pageName } }));
    }
  }

  updateNav(pageName) {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageName);
    });
  }

  init() {
    // Handle hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1) || 'replay';
      this.navigate(hash);
    });

    // Navigate to initial page
    const initial = window.location.hash.slice(1) || 'replay';
    this.navigate(initial);
  }
}

export const router = new Router();
