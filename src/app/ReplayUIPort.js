import { EventEmitter } from '../core/EventEmitter.js';

/** Neutral presentation adapter for replay engine events and commands. */
export function createReplayUIPort(engine) {
  if (!engine) throw new TypeError('createReplayUIPort requires an engine');
  return Object.freeze({
    play: () => engine.play(),
    pause: () => engine.pause(),
    stepForward: () => engine.stepForward(),
    reset: () => engine.reset(),
    start: (index) => engine.start(index),
    setSpeed: (speed) => engine.setSpeed(speed),
    seek: (index) => engine.seek(index),
    getState: () => Object.freeze({ ...engine.getState() }),
    getTotalCandles: () => engine.getTotalCandles(),
    on: (event, listener) => engine.on(event, listener),
  });
}
