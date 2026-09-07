/**
 * Narrow, immutable replay capability exposed to presentation code.
 * Presentation can drive replay, query visible state, and subscribe only to
 * presentation lifecycle events. Execution-only market events are unreachable.
 */
import { ReplayEvents } from '../replay/ReplayEvents.js';

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
    onStateChanged: (listener) => subscribe(ReplayEvents.STATE_CHANGED, listener),
    onSpeedChanged: (listener) => subscribe(ReplayEvents.SPEED_CHANGED, listener),
    onStarted: (listener) => subscribe(ReplayEvents.STARTED, listener),
    onSeeked: (listener) => subscribe(ReplayEvents.SEEKED, listener),
    onReset: (listener) => subscribe(ReplayEvents.RESET, listener),
    onStepped: (listener) => subscribe(ReplayEvents.STEPPED, listener),
  });
}
