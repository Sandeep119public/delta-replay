import assert from 'node:assert/strict';
import test from 'node:test';

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
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
  closest() { return null; }
  querySelectorAll() { return this.id === 'trading-panel' ? [this.document.elements.get('trade-qty')] : []; }
}

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

  return {
    document,
    elements,
    restore() {
      globalThis.document = previous.document;
      globalThis.window = previous.window;
      globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    },
  };
}

test('mobile trading focus opens the authoritative drawer and focuses order quantity', () => {
  const dom = installFakeDom();
  const drawer = bindMobileDrawer();

  assert.equal(drawer.focusTradingPanel(), true);
  assert.equal(dom.document.body.classList.contains('drawer-open'), true);
  assert.equal(dom.elements.get('btn-trading-drawer').getAttribute('aria-expanded'), 'true');
  assert.equal(dom.elements.get('trading-panel').getAttribute('aria-hidden'), 'false');
  assert.equal(dom.document.activeElement, dom.elements.get('trade-qty'));

  drawer.destroy();
  dom.restore();
});

test('desktop trading focus does not open the mobile drawer', () => {
  const dom = installFakeDom({ mobile: false });
  const drawer = bindMobileDrawer();

  assert.equal(drawer.focusTradingPanel(), true);
  assert.equal(dom.document.body.classList.contains('drawer-open'), false);
  assert.equal(dom.document.activeElement, dom.elements.get('trade-qty'));

  drawer.destroy();
  dom.restore();
});
