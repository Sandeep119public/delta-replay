/**
 * Event name constants for ReplayEngine.
 */
export const ReplayEvents = {
  LOADED: 'loaded',
  STARTED: 'started',
  PLAYED: 'played',
  PAUSED: 'paused',
  STEPPED: 'stepped',
  SEEKED: 'seeked',
  CANDLE: 'candle',           // alias for marketCandle
  MARKET_CANDLE: 'marketCandle', // deterministic payload for future trading engine
  SPEED_CHANGED: 'speedChanged',
  ENDED: 'ended',
  STOPPED: 'stopped',
  STATE_CHANGED: 'stateChanged',
  RESET: 'reset'
};
