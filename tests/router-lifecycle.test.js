import { describe, it, expect } from 'vitest';
import { Router } from '../src/router/Router.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement {
  constructor(id, page) {
    this.id = id;
    this.dataset = { page };
    this.classList = new FakeClassList();
    this.hidden = false;
    this.style = { display: '' };
    this.listeners = new Map();
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  setAttribute() {}
  removeAttribute() {}
  contains() { return true; }
}

function createHarness() {
  const pages = ['replay', 'dashboard', 'datasets'].map((name) => new FakeElement(`page-${name}`, name));
  const links = pages.map((page) => ({ dataset: { page: page.dataset.page }, classList: new FakeClassList(), setAttribute() {}, removeAttribute() {} }));
  const doc = {
    getElementById(id) { return pages.find((page) => page.id === id) ?? null; },
    querySelectorAll(selector) { return selector.startsWith('.page') ? pages : links; },
    addEventListener() {},
    removeEventListener() {},
  };
  const listeners = new Map();
  const win = {
    location: { hash: '' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); },
    CustomEvent: globalThis.CustomEvent,
  };
  return { pages, doc, win };
}

describe('Router component lifecycle', () => {
  it('mounts the selected component and destroys it exactly once when leaving', () => {
    const { doc, win } = createHarness();
    const events = [];
    const router = new Router({ doc, win });
    const dashboard = { mount: (element) => events.push(['mount', element.id]), destroy: () => events.push(['destroy']) };
    const datasets = { mount: (element) => events.push(['mount-datasets', element.id]), destroy: () => events.push(['destroy-datasets']) };
    router.register('replay');
    router.register('dashboard', dashboard);
    router.register('datasets', datasets);

    router.init();
    router.navigate('dashboard');
    router.navigate('datasets');
    router.navigate('datasets');
    router.destroy();

    expect(events).toEqual([
      ['mount', 'page-dashboard'],
      ['destroy'],
      ['mount-datasets', 'page-datasets'],
      ['destroy-datasets'],
    ]);
  });

  it('rejects partial component contracts instead of silently ignoring them', () => {
    const router = new Router({ doc: createHarness().doc, win: createHarness().win });
    expect(() => router.register('broken', { mount() {} })).toThrow(/must expose mount.*destroy/);
  });
});
