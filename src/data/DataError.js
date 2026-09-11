export const ErrorCategory = Object.freeze({
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
  INTEGRITY: 'INTEGRITY',
});

export const LoadingState = Object.freeze({
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

const USER_MESSAGES = {
  [ErrorCategory.INVALID_REQUEST]: 'Invalid request parameters.',
  [ErrorCategory.NETWORK]: "Couldn't load historical candles. Check your connection.",
  [ErrorCategory.TIMEOUT]: 'Request timed out. Try a smaller date range.',
  [ErrorCategory.HTTP]: "Couldn't load historical candles.",
  [ErrorCategory.CORS]: "Couldn't load historical candles due to a network restriction.",
  [ErrorCategory.ABORTED]: 'Load cancelled.',
  [ErrorCategory.INVALID_RESPONSE]: 'Received invalid data from the server.',
  [ErrorCategory.NO_DATA]: 'No candles found for the selected range.',
  [ErrorCategory.CACHE]: 'Cached data could not be used; a fresh load is required.',
  [ErrorCategory.INTEGRITY]: 'Historical data failed integrity validation.',
  [ErrorCategory.UNKNOWN]: 'An unexpected error occurred.',
};

const codeToCategory = Object.freeze({
  NETWORK_ERROR: ErrorCategory.NETWORK,
  TIMEOUT: ErrorCategory.TIMEOUT,
  CORS_ERROR: ErrorCategory.CORS,
  API_ERROR: ErrorCategory.HTTP,
  INVALID_RESPONSE: ErrorCategory.INVALID_RESPONSE,
  INVALID_REQUEST: ErrorCategory.INVALID_REQUEST,
  NO_DATA: ErrorCategory.NO_DATA,
  ABORT: ErrorCategory.ABORTED,
  CACHE_ERROR: ErrorCategory.CACHE,
  CACHE_INTEGRITY_ERROR: ErrorCategory.CACHE,
  INTEGRITY_ERROR: ErrorCategory.INTEGRITY,
  INTEGRITY_PROCESSING_FAILED: ErrorCategory.INTEGRITY,
});

const validCategories = new Set(Object.values(ErrorCategory));

export class DataError extends Error {
  constructor({ category, technicalMessage, context = {}, cause = null }) {
    super(technicalMessage, cause ? { cause } : undefined);
    this.name = 'DataError';
    this.category = category || ErrorCategory.UNKNOWN;
    this.technicalMessage = technicalMessage;
    this.userMessage = USER_MESSAGES[this.category] || USER_MESSAGES[ErrorCategory.UNKNOWN];
    this.context = {
      symbol: context.symbol || null,
      timeframe: context.timeframe || null,
      start: context.start ?? null,
      end: context.end ?? null,
      url: context.url || null,
      status: context.status ?? null,
      cause: cause || context.cause || null,
      estimated: context.estimated ?? null,
      max: context.max ?? null,
      ...context,
    };
  }

  toUserString() {
    const parts = [this.userMessage];
    if (this.context.symbol && this.context.timeframe) parts.push(`${this.context.symbol} · ${this.context.timeframe}`);
    if (this.context.start != null && this.context.end != null) {
      const fmt = (ts) => {
        try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
        catch { return String(ts); }
      };
      parts.push(`${fmt(this.context.start)} → ${fmt(this.context.end)}`);
    }
    return parts.join('\n');
  }

  toTechnicalString() {
    const parts = [`[${this.category}] ${this.technicalMessage}`];
    if (this.context.url) parts.push(`URL: ${this.context.url}`);
    if (this.context.status != null) parts.push(`HTTP ${this.context.status}`);
    if (this.context.cause?.message) parts.push(`Cause: ${this.context.cause.message}`);
    if (this.context.cause?.stack) parts.push(`Cause stack: ${this.context.cause.stack}`);
    return parts.join('\n');
  }

  static fromDeltaError(deltaErr) {
    const category = codeToCategory[deltaErr?.code] || ErrorCategory.UNKNOWN;
    return new DataError({ category, technicalMessage: deltaErr?.message || String(deltaErr), context: deltaErr?.details || {}, cause: deltaErr?.details?.cause || deltaErr });
  }

  static fromGenericError(err) {
    if (err instanceof DataError) return err;
    if (err?.name === 'AbortError') return new DataError({ category: ErrorCategory.ABORTED, technicalMessage: err.message || 'Aborted', cause: err });
    const msg = (err?.message ?? String(err)).toLowerCase();
    if (err?.code && codeToCategory[err.code]) return new DataError({ category: codeToCategory[err.code], technicalMessage: err.message || String(err), context: err.context || {}, cause: err });
    if (validCategories.has(err?.category)) return new DataError({ category: err.category, technicalMessage: err.message || String(err), context: err.context || {}, cause: err });
    if (msg.includes('illegal invocation')) return new DataError({ category: ErrorCategory.INVALID_REQUEST, technicalMessage: `Fetch binding error: ${err.message}`, context: { cause: err }, cause: err });
    if (msg.includes('timeout') || err?.name === 'TimeoutError') return new DataError({ category: ErrorCategory.TIMEOUT, technicalMessage: err.message || 'Request timed out', context: { cause: err }, cause: err });
    if (msg.includes('cors')) return new DataError({ category: ErrorCategory.CORS, technicalMessage: err.message || 'CORS error', context: { cause: err }, cause: err });
    if (msg.includes('failed to fetch') || msg.includes('networkerror')) return new DataError({ category: ErrorCategory.NETWORK, technicalMessage: err.message || 'Network error', context: { cause: err }, cause: err });
    return new DataError({ category: ErrorCategory.UNKNOWN, technicalMessage: err?.message || String(err), context: { cause: err }, cause: err });
  }
}
