import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createReplayUIPort } from '../src/app/ReplayUIPort.js';

describe('Replay UI port', () => {
  it('exposes only validated replay capabilities and deep-freezes snapshots', () => {
    const listeners = new Map();
    const engine = {
      play() {},
      pause() {},
      stepForward() {},
      reset() {},
      start() {},
      setSpeed() {},
      seek() {},
      getState() {
        return { status: 'ready', nested: { currentIndex: 3 } };
      },
      getTotalCandles() {
        return 2;
      },
      getVisibleCandles() {
        return [{ time: 1, meta: { volume: 10 } }];
      },
      on(event, listener) {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    };

    const port = createReplayUIPort(engine);
    assert(Object.isFrozen(port));
    assert.equal(typeof port.on, 'undefined');

    const state = port.getState();
    const candles = port.getVisibleCandles();
    assert(Object.isFrozen(state));
    assert(Object.isFrozen(state.nested));
    assert(Object.isFrozen(candles));
    assert(Object.isFrozen(candles[0]));
    assert(Object.isFrozen(candles[0].meta));

    assert.equal(port.getTotalCandles(), 2);
    assert.equal(listeners.size, 0);
  });

  it('fails fast when a required engine capability is missing', () => {
    assert.throws(
      () => createReplayUIPort({}),
      /requires replay capabilities/,
    );
  });
});
