import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReplayCommandPresentationPort,
  createDeferredReplayCommandPresentationPort,
  createReplayCommandPresentationPort,
} from '../../src/ports/ReplayCommandPresentationPort.js';

const COMMANDS = ['togglePlayPause', 'pause', 'stepForward', 'reset', 'setSpeed'];

function makeController(calls) {
  return Object.fromEntries(COMMANDS.map((name) => [name, (...args) => {
    calls.push([name, ...args]);
    return name;
  }]));
}

test('replay command presentation port exposes only user intents', () => {
  const calls = [];
  const port = createReplayCommandPresentationPort(makeController(calls));
  assert.ok(Object.isFrozen(port));
  assert.deepEqual(Object.keys(port), COMMANDS);
  assert.equal(port.setSpeed('2'), 'setSpeed');
  assert.deepEqual(calls, [['setSpeed', '2']]);
});

test('replay command presentation port rejects incomplete owners', () => {
  assert.throws(() => createReplayCommandPresentationPort({ pause() {} }), /command owner/);
  assert.throws(() => assertReplayCommandPresentationPort({ pause() {} }), /requires togglePlayPause/);
});

test('deferred replay command port remains stable while the application wires the owner', () => {
  const bridge = createDeferredReplayCommandPresentationPort();
  assert.ok(Object.isFrozen(bridge.port));
  assert.equal(bridge.port.pause(), false);

  const calls = [];
  bridge.bind(makeController(calls));
  assert.equal(bridge.port.setSpeed(5), 'setSpeed');
  assert.deepEqual(calls, [['setSpeed', 5]]);

  bridge.destroy();
  assert.equal(bridge.port.pause(), false);
});
