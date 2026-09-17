import assert from 'node:assert/strict';
import test from 'node:test';

function createElement(document, tagName) {
  const listeners = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    classList: {
      values: new Set(),
      contains(value) { return this.values.has(value); },
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
    },
    attributes: new Map(),
    children: [],
    value: '',
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    addEventListener(type, handler) {
      const set = listeners.get(type) || new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.append(node); },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
    querySelector(selector) {
      if (selector === '.phase6-command-search') return this.children.find((child) => child.className === 'phase6-command-search') || null;
      if (selector === '.phase6-command-list') return this.children.find((child) => child.className === 'phase6-command-list') || null;
      if (selector === '.phase6-command-close') return this.children.find((child) => child.className === 'phase6-command-close') || null;
      return null;
    },
    querySelectorAll() { return []; },
    focus() { document.activeElement = this; },
    scrollIntoView() {},
    remove() {},
    innerHTML: '',
    textContent: '',
  };
  return element;
}

function installDom() {
  const previous = globalThis.document;
  const document = {
    activeElement: null,
    body: null,
    createElement(tagName) { return createElement(document, tagName); },
    querySelector(selector) { return selector === '.phase6-command-trigger' ? null : null; },
    addEventListener() {},
    removeEventListener() {},
  };
  const body = createElement(document, 'body');
  const topbarRight = createElement(document, 'div');
  topbarRight.className = 'topbar-right';
  document.body = body;
  document.querySelector = (selector) => selector === '.phase6-command-trigger' ? null : selector === '.topbar-right' ? topbarRight : null;
  body.appendChild(topbarRight);
  globalThis.document = document;
  return () => { globalThis.document = previous; };
}

test('command surface exports an idempotent lifecycle resource', async () => {
  const restore = installDom();
  try {
    const { createCommandSurface } = await import(`../../src/ui/CommandSurface.js?contract=${Date.now()}`);
    const surface = createCommandSurface();
    assert.equal(typeof surface.destroy, 'function');
    surface.destroy();
    surface.destroy();
  } finally {
    restore();
  }
});
