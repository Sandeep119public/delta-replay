export const ReplayStatus = {
  IDLE: 'idle',
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ENDED: 'ended'
};

export const ALLOWED_SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

export function isValidSpeed(s) {
  return ALLOWED_SPEEDS.includes(Number(s));
}

/**
 * Factory for initial state.
 */
export function createInitialState() {
  return {
    status: ReplayStatus.IDLE,
    currentIndex: -1,
    startIndex: -1,
    speed: 1,
    totalCandles: 0
  };
}
