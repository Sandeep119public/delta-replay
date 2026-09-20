import { afterEach, describe, expect, it } from 'vitest';
import { bindMobileNavigation } from '../src/app/bindMobileNavigation.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const add = force === undefined ? !this.values.has(name) : force;
    if (add) this.values.add(name); else this.values.delete(name);
    return add;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(document, { id = '', className = '' } = {}) {
    this.document = document;
    this.id = id;
    this.className = className;
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.focusable = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  focus() { this.document.activeElement = this; }
  querySelector(selector) {
    if (selector.includes('.nav-link.active')) return this.focusable.find((el) => el.active) || this.focusable[0] || null;
    if (selector.includes('.nav-link')) return this.focusable[0] || null;
    return null;
  }
  querySelectorAll() { return this.focusable; }
  closest() { return null; }
}

let restoreDom = () => {};
afterEach(() => restoreDom());

function installDom({ mobile = true } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame };
  const document = {
    activeElement: null,
    body: new FakeElement(null, { id: 'body' }),
    listeners: new Map(),
    getElementById(id) { return this.elements.get(id) || null; },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
    elements: new Map(),
  };
  document.body.document = document;
  const toggle = new FakeElement(document, { id: 'mobile-nav-toggle' });
  const scrim = new FakeElement(document, { id: 'mobile-nav-scrim' });
  const sidebar = new FakeElement(document, { id: 'app-sidebar' });
  const first = new FakeElement(document, { className: 'nav-link' });
  const last = new FakeElement(document, { className: 'nav-link' });
  sidebar.focusable = [first, last];
  document.elements.set(toggle.id, toggle);
  document.elements.set(scrim.id, scrim);
  document.elements.set(sidebar.id, sidebar);
  document.activeElement = toggle;

  const media = { matches: mobile };
  const window = {
    innerWidth: mobile ? 390 : 1280,
    matchMedia: () => media,
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.requestAnimationFrame = (cb) => cb();

  restoreDom = () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  };
  return { document, window, toggle, scrim, sidebar, first, last };
}

describe('mobile navigation accessibility', () => {
  it('marks the mobile sidebar inert to assistive technology while closed and traps focus while open', () => {
    const dom = installDom();
    const nav = bindMobileNavigation();

    expect(dom.sidebar.getAttribute('aria-hidden')).toBe('true');
    nav.setOpen(true);
    expect(dom.sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(dom.document.activeElement).toBe(dom.first);

    dom.document.activeElement = dom.last;
    dom.document.listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() {} });
    expect(dom.document.activeElement).toBe(dom.first);

    dom.document.activeElement = dom.first;
    dom.document.listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} });
    expect(dom.document.activeElement).toBe(dom.last);

    nav.setOpen(false);
    expect(dom.sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(dom.document.activeElement).toBe(dom.toggle);
    nav.destroy();
  });

  it('never hides the persistent sidebar from assistive technology on desktop', () => {
    const dom = installDom({ mobile: false });
    const nav = bindMobileNavigation();
    expect(dom.sidebar.getAttribute('aria-hidden')).toBe(null);
    nav.setOpen(true);
    expect(dom.sidebar.getAttribute('aria-hidden')).toBe(null);
    nav.destroy();
  });
});
