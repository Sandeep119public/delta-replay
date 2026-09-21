const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class DatasetService {
  constructor({ baseUrl = API_BASE, fetchFn = null } = {}) {
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn || globalThis.fetch.bind(globalThis);
  }

  async _request(path, options = {}) {
    const response = await this.fetchFn(`${this.baseUrl}/api/v1/data${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body?.detail || body?.message || `Dataset API failed: ${response.status}`);
      error.status = response.status;
      error.code = 'DATASET_API_ERROR';
      throw error;
    }
    return body;
  }

  download({ symbol, timeframe, from, to }) {
    return this._request('/download', {
      method: 'POST',
      body: JSON.stringify({ symbol, timeframe, from, to }),
    });
  }

  list({ symbol = null, timeframe = null } = {}) {
    const params = new URLSearchParams();
    if (symbol) params.set('symbol', String(symbol).toUpperCase());
    if (timeframe) params.set('timeframe', String(timeframe));
    const query = params.toString();
    return this._request(`/datasets${query ? `?${query}` : ''}`);
  }
}
