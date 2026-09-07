/**
 * Neutral presentation copies of loading/error categories.
 * UI layers import these instead of the data-layer DataError module so the
 * presentation boundary does not depend on data internals.
 */

export const PRESENTATION_ERROR_CATEGORIES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  HTTP: 'HTTP',
  CORS: 'CORS',
  ABORTED: 'ABORTED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  NO_DATA: 'NO_DATA',
  CACHE: 'CACHE',
  UNKNOWN: 'UNKNOWN',
});

export const PRESENTATION_LOADING_STATES = Object.freeze({
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  SUCCESS: 'SUCCESS',
  EMPTY: 'EMPTY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  HTTP_ERROR: 'HTTP_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_DATA: 'INVALID_DATA',
  ABORTED: 'ABORTED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const RETRYABLE = new Set([
  PRESENTATION_ERROR_CATEGORIES.NETWORK,
  PRESENTATION_ERROR_CATEGORIES.TIMEOUT,
  PRESENTATION_ERROR_CATEGORIES.CORS,
]);

export function isRetryableCategory(category) {
  return RETRYABLE.has(category);
}
