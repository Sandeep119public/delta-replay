function freezeValue(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child);
  return Object.freeze(copy);
}

function freezeCandleArray(candles) {
  if (!Array.isArray(candles)) return Object.freeze([]);
  for (const candle of candles) {
    if (candle && typeof candle === 'object') Object.freeze(candle);
  }
  return Object.freeze(candles);
}

export function createReplayUIPort(engine) {
  if (!engine || typeof engine !== 'object') throw new TypeError('createReplayUIPort requires replay engine');
  for (const method of ['play', 'pause', 'stepForward', 'reset', 'start', 'setSpeed', 'seek', 'getState', 'getTotalCandles', 'getCandle', 'getVisibleCandles', 'getCandleWindow', 'getTimelineTimes']) {
    if (typeof engine[method] !== 'function') throw new TypeError('Replay engine does not expose ' + method);
  }

  return Object.freeze({
    play: (...args) => engine.play(...args),
    pause: (...args) => engine.pause(...args),
    stepForward: (...args) => engine.stepForward(...args),
    reset: (...args) => engine.reset(...args),
    start: (...args) => engine.start(...args),
    setSpeed: (...args) => engine.setSpeed(...args),
    seek: (...args) => engine.seek(...args),
    getState: () => freezeValue(engine.getState()),
    getTotalCandles: () => engine.getTotalCandles(),
    getCandle: (index) => {
      const candle = engine.getCandle(index);
      return candle ? Object.freeze(candle) : null;
    },
    getVisibleCandles: () => freezeCandleArray(engine.getVisibleCandles()),
    getCandleWindow: (index, windowSize = 1000) => freezeCandleArray(engine.getCandleWindow(index, windowSize)),
    getTimelineTimes: () => Object.freeze(engine.getTimelineTimes().slice()),
    on: (event, handler) => engine.on(event, handler),
    onStateChanged: (handler) => engine.on('stateChanged', handler),
    onStarted: (handler) => engine.on('started', handler),
    onSeeked: (handler) => engine.on('seeked', handler),
    onStepped: (handler) => engine.on('stepped', handler),
    onReset: (handler) => engine.on('reset', handler),
    onSpeedChanged: (handler) => engine.on('speedChanged', handler),
    onPlaybackError: (handler) => engine.on('playbackError', handler),
  });
}
