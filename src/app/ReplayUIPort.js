/**
 * Narrow capability boundary between presentation and ReplayEngine.
 * UI receives only commands, immutable state reads, and subscriptions.
 */
export function createReplayUIPort(engine) {
  const port = {
    play: () => engine.play(),
    pause: () => engine.pause(),
    stepForward: () => engine.stepForward(),
    reset: () => engine.reset(),
    start: (index) => engine.start(index),
    setSpeed: (speed) => engine.setSpeed(speed),
    getState: () => Object.freeze({ ...engine.getState() }),
    getTotalCandles: () => engine.getTotalCandles(),
    on: (event, listener) => engine.on(event, listener),
  };
  return Object.freeze(port);
}
