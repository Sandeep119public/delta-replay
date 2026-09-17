import assert from 'node:assert/strict';
import test from 'node:test';

function createDocument() {
  const listeners = new Map();
  const elements = new Map();
  const document = {
    activeElement: null,
    body: { appendChild(element) { element.parentNode = document.body; } },
    querySelector() { return null; },
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, handler) {
      const set = listeners.get(type) || new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    createElement(tagName) {
      const element = {
        tagName: tagName.toUpperCase(),
        className: '',
        attributes: new Map(),
        children: [],
        classList: { contains: () => false, add() {}, remove() {} },
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        append() {},
        appendChild() {},
        addEventListener(type, handler) { this._handlers ||= new Map(); this._handlers.set(type, handler); },
        removeEventListener(type) { this._handlers?.delete(type); },
        focus() { document.activeElement = this; },
        remove() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        replaceChildren() {},
        scrollIntoView() {},
        innerHTML: '',
        textContent: '',
      };
      return element;
    },
  };
  return { document, listeners, elements };
}

test('command surface exports its cleanup as an idempotent lifecycle resource', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const { document } = createDocument();
  globalThis.document = document;
  globalThis.window = { requestAnimationFrame(callback) { callback(); } };

  try {
    const { createCommandSurface } = await import(`../../src/ui/CommandSurface.js?contract=${Date.now()}`);
    const surface = createCommandSurface();
    assert.equal(typeof surface.destroy, 'function');
    surface.destroy();
    surface.destroy();
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
