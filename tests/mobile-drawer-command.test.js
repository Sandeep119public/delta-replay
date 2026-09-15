import { afterEach, describe, expect, it } from 'vitest';

import { bindMobileDrawer } from '../src/ui/bindMobileDrawer.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : force;
    if (shouldAdd) this.values.add(name); else this.values.delete(name);
    return shouldAdd;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.scrollTop = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 100 }; }
  closest() { return null; }
  querySelectorAll() { return this.id === 'trading-panel' ? [this.document.elements.get('trade-qty')] : []; }
}

let restoreDom = () => {};
afterEach(() => restoreDom());

function installFakeDom({ mobile = true } = {}) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  const elements = new Map();
  const document = {
    elements,
    activeElement: null,
    body: new FakeElement('body', null),
    listeners: new Map(),
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
  };
  document.body.document = document;
  for (const id of ['btn-trading-drawer', 'drawer-scrim', 'trading-panel', 'trade-qty', 'accessibility-live']) {
    elements.set(id, new FakeElement(id, document));
  }
  document.activeElement = elements.get('btn-trading-drawer');

  const media = {
    matches: mobile,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.window = {
    innerWidth: mobile ? 390 : 1280,
    matchMedia: () => media,
  };
  globalThis.requestAnimationFrame = (callback) => callback();

  restoreDom = () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  };

  return { document, elements };
}

describe('mobile trading drawer focus capability', () => {
  it('opens the authoritative drawer and focuses order quantity on mobile', () => {
    const dom = installFakeDom();
    const drawer = bindMobileDrawer();

    expect(drawer.focusTradingPanel()).toBe(true);
    expect(dom.document.body.classList.contains('drawer-open')).toBe(true);
    expect(dom.elements.get('btn-trading-drawer').getAttribute('aria-expanded')).toBe('true');
    expect(dom.elements.get('trading-panel').getAttribute('aria-hidden')).toBe('false');
    expect(dom.document.activeElement).toBe(dom.elements.get('trade-qty'));

    drawer.destroy();
  });

  it('does not open the mobile drawer on desktop', () => {
    const dom = installFakeDom({ mobile: false });
    const drawer = bindMobileDrawer();

    expect(drawer.focusTradingPanel()).toBe(true);
    expect(dom.document.body.classList.contains('drawer-open')).toBe(false);
    expect(dom.document.activeElement).toBe(dom.elements.get('trade-qty'));

    drawer.destroy();
  });

  it('does not close while a downward gesture starts inside scrolled drawer content', () => {
    const dom = installFakeDom();
    const drawer = bindMobileDrawer();
    const panel = dom.elements.get('trading-panel');
    drawer.setDrawer(true);
    panel.scrollTop = 120;

    panel.listeners.get('touchstart')({ touches: [{ clientY: 240 }] });
    panel.listeners.get('touchend')({ changedTouches: [{ clientY: 340 }] });

    expect(dom.document.body.classList.contains('drawer-open')).toBe(true);
    drawer.destroy();
  });

  it('closes when a downward gesture starts at the sheet top edge while scrolled to the top', () => {
    const dom = installFakeDom();
    const drawer = bindMobileDrawer();
    const panel = dom.elements.get('trading-panel');
    drawer.setDrawer(true);
    panel.scrollTop = 0;

    panel.listeners.get('touchstart')({ touches: [{ clientY: 120 }] });
    panel.listeners.get('touchend')({ changedTouches: [{ clientY: 220 }] });

    expect(dom.document.body.classList.contains('drawer-open')).toBe(false);
    drawer.destroy();
  });
});
