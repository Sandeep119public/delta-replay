/**
 * Structured application error hierarchy for data loading.
 * Each error preserves code, user message, technical details, and request context.
 */

export const ErrorCategory = {
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
};

export const LoadingState = {
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
};

const USER_MESSAGES = {
  [ErrorCategory.INVALID_REQUEST]: 'Invalid request parameters.',
  [ErrorCategory.NETWORK]: "Couldn't load historical candles. Check your connection.",
  [ErrorCategory.TIMEOUT]: 'Request timed out. Try a smaller date range.',
  [ErrorCategory.HTTP]: "Couldn't load historical candles.",
  [ErrorCategory.CORS]: "Couldn't load historical candles due to a network restriction.",
  [ErrorCategory.ABORTED]: 'Load cancelled.',
  [ErrorCategory.INVALID_RESPONSE]: 'Received invalid data from the server.',
  [ErrorCategory.NO_DATA]: 'No candles found for the selected range.',
  [ErrorCategory.CACHE]: 'Cache error.',
  [ErrorCategory.UNKNOWN]: 'An unexpected error occurred.',
};

export class DataError extends Error {
  /**
   * @param {object} opts
   * @param {string} opts.category - ErrorCategory value
   * @param {string} opts.technicalMessage - Implementation-level message
   * @param {object} [opts.context] - { symbol, timeframe, start, end, url, status, cause }
   */
  constructor({ category, technicalMessage, context = {} }) {
    super(technicalMessage);
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
      cause: context.cause || null,
      estimated: context.estimated ?? null,
      max: context.max ?? null,
    };
  }

  toUserString() {
    const parts = [this.userMessage];
    if (this.context.symbol && this.context.timeframe) {
      parts.push(`${this.context.symbol} \u00b7 ${this.context.timeframe}`);
    }
    if (this.context.start != null && this.context.end != null) {
      const fmt = (ts) => {
        try { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
        catch { return String(ts); }
      };
      parts.push(`${fmt(this.context.start)} \u2192 ${fmt(this.context.end)}`);
    }
    return parts.join('\n');
  }

  toTechnicalString() {
    const parts = [`[${this.category}] ${this.technicalMessage}`];
    if (this.context.url) parts.push(`URL: ${this.context.url}`);
    if (this.context.status) parts.push(`HTTP ${this.context.status}`);
    if (this.context.cause?.message) parts.push(`Cause: ${this.context.cause.message}`);
    return parts.join('\n');
  }

  static fromDeltaError(deltaErr) {
    const codeToCategory = {
      NETWORK_ERROR: ErrorCategory.NETWORK,
      TIMEOUT: ErrorCategory.TIMEOUT,
      CORS_ERROR: ErrorCategory.CORS,
      API_ERROR: ErrorCategory.HTTP,
      INVALID_RESPONSE: ErrorCategory.INVALID_RESPONSE,
      INVALID_REQUEST: ErrorCategory.INVALID_REQUEST,
      NO_DATA: ErrorCategory.NO_DATA,
      ABORT: ErrorCategory.ABORTED,
    };
    const category = codeToCategory[deltaErr.code] || ErrorCategory.UNKNOWN;
    return new DataError({
      category,
      technicalMessage: deltaErr.message || String(deltaErr),
      context: deltaErr.details || {},
    });
  }

  static fromGenericError(err) {
    const msg = (err?.message ?? String(err)).toLowerCase();
    if (err?.name === 'AbortError') {
      return new DataError({ category: ErrorCategory.ABORTED, technicalMessage: 'Aborted' });
    }
    if (msg.includes('illegal invocation')) {
      return new DataError({
        category: ErrorCategory.INVALID_REQUEST,
        technicalMessage: `Fetch binding error: ${err.message}`,
        context: { cause: err },
      });
    }
    if (msg.includes('timeout') || err?.name === 'TimeoutError') {
      return new DataError({
        category: ErrorCategory.TIMEOUT,
        technicalMessage: err.message || 'Request timed out',
        context: { cause: err },
      });
    }
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('cors')) {
      return new DataError({
        category: ErrorCategory.NETWORK,
        technicalMessage: err.message || 'Network error',
        context: { cause: err },
      });
    }
    if (err?.code) {
      return new DataError({
        category: codeToCategory[err.code] || ErrorCategory.UNKNOWN,
        technicalMessage: err.message || String(err),
        context: { cause: err },
      });
    }
    return new DataError({
      category: ErrorCategory.UNKNOWN,
      technicalMessage: err.message || String(err),
      context: { cause: err },
    });
  }
}

const codeToCategory = {
  INVALID_REQUEST: ErrorCategory.INVALID_REQUEST,
  NETWORK_ERROR: ErrorCategory.NETWORK,
  TIMEOUT: ErrorCategory.TIMEOUT,
  CORS_ERROR: ErrorCategory.CORS,
  API_ERROR: ErrorCategory.HTTP,
  INVALID_RESPONSE: ErrorCategory.INVALID_RESPONSE,
  NO_DATA: ErrorCategory.NO_DATA,
  ABORT: ErrorCategory.ABORTED,
};
