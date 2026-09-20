const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_REQUEST_TIMEOUT_MS = 30_000;

export class BackendService {
  constructor(path, sessionId) {
    if (!path) throw new TypeError('BackendService path is required');
    if (!sessionId) throw new TypeError('BackendService sessionId is required');
    this.path = path;
    this.sessionId = sessionId;
  }

  request(endpoint = '', options = {}) {
    return (async () => {
      const controller = options.signal ? null : new AbortController();
      const timeout = controller ? setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS) : null;
      try {
        const response = await fetch(`${API_BASE}/api/v1/${this.path}${endpoint}`, {
          ...options,
          ...(controller ? { signal: controller.signal } : {}),
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': this.sessionId,
            ...(options.headers || {}),
          },
        });
        let body = null;
        if (response.status !== 204) {
          try { body = await response.json(); } catch { body = null; }
        }
        if (!response.ok) {
          const message = body?.detail || body?.message || `${this.path} API failed: ${response.status}`;
          const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
          error.status = response.status;
          error.code = `HTTP_${response.status}`;
          error.details = body;
          throw error;
        }
        return body;
      } catch (error) {
        if (error?.name === 'AbortError' && controller?.signal.aborted) {
          const timeoutError = new Error(`${this.path} API request timed out after ${API_REQUEST_TIMEOUT_MS}ms`);
          timeoutError.code = 'TIMEOUT';
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    })();
  }
}
