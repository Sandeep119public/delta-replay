import { ReplayEngine } from './ReplayEngine.js';

/** Creates a narrow, immutable application-facing replay port. */
export function createReplayUIPort(engine) {
  if (!(engine instanceof ReplayEngine) && (!engine || typeof engine.play !== 'function')) {
    throw new TypeError('createReplayUIPort requires a ReplayEngine-compatible object');
  }
  return Object.freeze({
    play: () => engine.play(),
    pause: () => engine.pause(),
    stepForward: () => engine.stepForward(),
    reset: () => engine.reset(),
    start: (index) => engine.start(index),
    seek: (index) => engine.seek(index),
    setSpeed: (speed) => engine.setSpeed(speed),
    getState: () => Object.freeze({ ...engine.getState() }),
    getTotalCandles: () => engine.getTotalCandles(),
    on: (event, listener) => engine.on(event, listener),
  });
}
