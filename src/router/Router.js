/** Browser page router with explicit component lifecycle ownership. */
export class Router {
  constructor({ win = null, doc = null, defaultPage = 'replay' } = {}) {
    this.pages = new Map();
    this.currentPage = null;
    this._activeComponent = null;
    this._win = win;
    this._doc = doc;
    this.defaultPage = defaultPage;
    this._onHashChange = () => this.onHashChange();
    this._onNavClick = (event) => {
      const link = event.target.closest?.('.nav-link[data-page]');
      if (!link) return;
      const pageName = link.dataset.page;
      if (!this.pages.has(pageName)) return;
      event.preventDefault?.();
      this.navigate(pageName);
    };
    this._initialized = false;
  }

  get win() { return this._win ?? globalThis.window; }
  get doc() { return this._doc ?? globalThis.document; }

  register(name, component = null, options = {}) {
    if (!name || typeof name !== 'string') throw new TypeError('page name must be a non-empty string');
    if (component != null && (typeof component.mount !== 'function' || typeof component.destroy !== 'function')) {
      throw new TypeError(`page component for ${name} must expose mount(element) and destroy()`);
    }
    if (this.currentPage === name) throw new Error(`cannot replace active page: ${name}`);
    this.pages.set(name, { component, options });
    return this;
  }

  _deactivateCurrent() {
    if (!this._activeComponent) return;
    this._activeComponent.destroy();
    this._activeComponent = null;
  }

  _activate(target, pageEl) {
    const component = this.pages.get(target)?.component;
    if (component) component.mount(pageEl, { pageName: target, router: this });
    this._activeComponent = component;
  }

  navigate(pageName) {
    const target = this.pages.has(pageName) ? pageName : this.defaultPage;
    const pageEl = this.doc.getElementById(`page-${target}`);
    if (!pageEl) return false;
    if (this.currentPage === target && pageEl.classList.contains('active')) {
      this.updateNav(target);
      return true;
    }

    const previous = this.currentPage;
    this._deactivateCurrent();
    try {
      this._activate(target, pageEl);
    } catch (error) {
      this._activeComponent = null;
      throw error;
    }

    if (this.win.location.hash.slice(1) !== target) this.win.location.hash = target;
    this.doc.querySelectorAll('.page[data-page]').forEach((el) => {
      const active = el === pageEl;
      el.classList.toggle('active', active);
      el.hidden = !active;
      el.style.display = active ? '' : 'none';
    });
    this.currentPage = target;
    this.updateNav(target);
    this.win.dispatchEvent(new CustomEvent('pagechange', { detail: { page: target, previousPage: previous } }));
    return true;
  }

  updateNav(pageName) {
    this.doc.querySelectorAll('.nav-link[data-page]').forEach((link) => {
      const active = link.dataset.page === pageName;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  onHashChange() { this.navigate(this.win.location.hash.slice(1) || this.defaultPage); }

  init() {
    if (this._initialized) return this;
    this._initialized = true;
    this.win.addEventListener('hashchange', this._onHashChange);
    this.doc.addEventListener('click', this._onNavClick);
    this.onHashChange();
    return this;
  }

  destroy() {
    if (!this._initialized) return;
    this._deactivateCurrent();
    this.win.removeEventListener('hashchange', this._onHashChange);
    this.doc.removeEventListener('click', this._onNavClick);
    this._initialized = false;
    this.currentPage = null;
  }
}

export function createRouter(options) {
  return new Router(options);
}
