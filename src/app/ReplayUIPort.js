/**
 * Narrow, immutable replay capability exposed to presentation code.
 * The UI can drive replay and observe presentation events, but cannot receive
 * execution-only market events or reach replay internals.
 */
export function createReplayUIPort(engine) {
  const required = ['play', 'pause', 'stepForward', 'reset', 'start', 'setSpeed', 'seek', 'getState', 'getTotalCandles', 'getVisibleCandles', 'on'];
  if (!engine || required.some((name) => typeof engine[name] !== 'function')) {
    throw new TypeError(`createReplayUIPort requires replay capabilities: ${required.join(', ')}`);
  }

  const subscribe = (event, listener) => engine.on(event, listener);
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
    getVisibleCandles: () => engine.getVisibleCandles().map((candle) => Object.freeze({ ...candle })),
    onStateChanged: (listener) => subscribe('stateChanged', listener),
    onSpeedChanged: (listener) => subscribe('speedChanged', listener),
    onStarted: (listener) => subscribe('started', listener),
    onSeeked: (listener) => subscribe('seeked', listener),
    onReset: (listener) => subscribe('reset', listener),
    onStepped: (listener) => subscribe('stepped', listener),
  });
}
