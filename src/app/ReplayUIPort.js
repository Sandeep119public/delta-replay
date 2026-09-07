/**
 * Narrow, immutable replay capability exposed to presentation code.
 * Presentation can drive replay, query visible state, and subscribe only to
 * presentation lifecycle events. Execution-only market events are unreachable.
 */
function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

export function createReplayUIPort(engine) {
  const required = [
    'play', 'pause', 'stepForward', 'reset', 'start', 'setSpeed', 'seek',
    'getState', 'getTotalCandles', 'getVisibleCandles', 'on',
  ];
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
    getState: () => freezeValue(engine.getState()),
    getTotalCandles: () => engine.getTotalCandles(),
    getVisibleCandles: () => freezeValue(engine.getVisibleCandles()),
    onStateChanged: (listener) => subscribe('stateChanged', listener),
    onSpeedChanged: (listener) => subscribe('speedChanged', listener),
    onStarted: (listener) => subscribe('started', listener),
    onSeeked: (listener) => subscribe('seeked', listener),
    onReset: (listener) => subscribe('reset', listener),
    onStepped: (listener) => subscribe('stepped', listener),
  });
}
