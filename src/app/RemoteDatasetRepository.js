const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 120_000;
const PUBLISH_TOKEN_KEY = 'delta-replay.github-publish-token';

function request(endpoint, options = {}) {
  return (async () => {
    const controller = options.signal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${API_BASE}/api/v1/datasets${endpoint}`, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body?.detail || body?.message || `Dataset API failed: ${response.status}`;
        const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
        error.status = response.status;
        error.code = `HTTP_${response.status}`;
        throw error;
      }
      return body;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();
}

export class RemoteDatasetRepository {
  constructor({ storage = globalThis.sessionStorage } = {}) {
    this.storage = storage;
  }

  _publishToken() {
    return this.storage?.getItem?.(PUBLISH_TOKEN_KEY) || '';
  }

  setPublishToken(token) {
    const value = String(token || '').trim();
    if (!value) this.storage?.removeItem?.(PUBLISH_TOKEN_KEY);
    else this.storage?.setItem?.(PUBLISH_TOKEN_KEY, value);
  }

  clearPublishToken() {
    this.storage?.removeItem?.(PUBLISH_TOKEN_KEY);
  }

  async list() {
    const result = await request('');
    return Array.isArray(result?.datasets) ? result.datasets : [];
  }

  async get(id) {
    if (!id) return null;
    const datasets = await this.list();
    return datasets.find((dataset) => dataset.id === id) || null;
  }

  async getCandles(id) {
    if (!id) throw new Error('Dataset id is required');
    const dataset = await request(`/${encodeURIComponent(id)}/candles`);
    if (!dataset?.metadata || !Array.isArray(dataset.candles)) throw new Error('Remote replay dataset is invalid');
    return { metadata: dataset.metadata, candles: dataset.candles };
  }

  async getCsv(id) {
    if (!id) throw new Error('Dataset id is required');
    const dataset = await request(`/${encodeURIComponent(id)}/csv`);
    if (!dataset?.metadata || typeof dataset.csv !== 'string') throw new Error('Remote replay dataset is invalid');
    return { metadata: dataset.metadata, csv: dataset.csv };
  }

  async save({ symbol, timeframe, from, to, candles, metadata = {} }) {
    let token = this._publishToken();
    if (!token && typeof globalThis.prompt === 'function') {
      token = String(globalThis.prompt('GitHub publish token (Contents: write for this repository):') || '').trim();
      if (token) this.setPublishToken(token);
    }
    if (!token) throw new Error('GitHub publish token is required to save a dataset');
    return request('/publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbol, timeframe, from, to, candles, metadata }),
    });
  }

  async remove() {
    throw new Error('Remote GitHub datasets are immutable; delete them from the dataset repository');
  }

  async clear() {
    throw new Error('Remote GitHub datasets are immutable; clear is not supported');
  }

  async destroy() {
    this.clearPublishToken();
  }
}
