import assert from 'node:assert/strict';
import test from 'node:test';

import { ReplayCommandController } from '../../src/app/ReplayCommandController.js';

function makeButton() {
  const listeners = new Map();
  return {
    textContent: '',
    attributes: new Map(),
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    click() { listeners.get('click')?.(); },
  };
}

function makeEngine(status) {
  const calls = [];
  const engine = {
    getState: () => ({ status, currentIndex: 2, speed: 1, startIndex: 1 }),
    getTotalCandles: () => 10,
    on: () => () => {},
    play: async () => { calls.push('play'); },
    pause: async () => { calls.push('pause'); },
    reset: async () => { calls.push('reset'); return { status: 'ready', currentIndex: 1, startIndex: 1 }; },
    seek: async (index) => { calls.push(`seek:${index}`); return { currentIndex: index }; },
    stepForward: async () => { calls.push('step'); },
    setSpeed: (speed) => { calls.push(`speed:${speed}`); return speed; },
  };
  return { engine, calls };
}

test('header replay control exposes the action represented by its state', async () => {
  for (const [status, expectedText, expectedLabel] of [
    ['ready', '▶ START REPLAY', 'Start replay'],
    ['playing', '⏸ PAUSE', 'Pause replay'],
    ['paused', '▶ RESUME', 'Resume replay'],
    ['ended', '↺ REPLAY AGAIN', 'Replay again'],
  ]) {
    const { engine } = makeEngine(status);
    const button = makeButton();
    const controller = new ReplayCommandController({
      engine,
      appState: { pendingStartIndex: 1 },
      candleStore: { getCount: () => 10 },
      headerBtn: button,
    });

    assert.equal(button.textContent, expectedText);
    assert.equal(button.attributes.get('aria-label'), expectedLabel);
    assert.equal(button.attributes.get('aria-keyshortcuts'), 'Space');
    controller.destroy();
  }
});

test('header control performs pause while playing instead of restarting replay', async () => {
  const { engine, calls } = makeEngine('playing');
  const button = makeButton();
  const controller = new ReplayCommandController({
    engine,
    appState: { pendingStartIndex: 1 },
    candleStore: { getCount: () => 10 },
    headerBtn: button,
  });

  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['pause']);
  controller.destroy();
});

test('header control resumes paused replay instead of starting a new position', async () => {
  const { engine, calls } = makeEngine('paused');
  const button = makeButton();
  const controller = new ReplayCommandController({
    engine,
    appState: { pendingStartIndex: 1 },
    candleStore: { getCount: () => 10 },
    headerBtn: button,
  });

  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['play']);
  controller.destroy();
});
