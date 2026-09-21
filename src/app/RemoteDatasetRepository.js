const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 120_000;
const PUBLISH_SECRET_KEY = 'delta-replay.dataset-publish-secret';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RemoteDatasetRepository {
  constructor({ storage = globalThis.sessionStorage } = {}) {
    this.storage = storage;
  }

  _publishSecret() {
    return this.storage?.getItem?.(PUBLISH_SECRET_KEY) || '';
  }

  setPublishSecret(secret) {
    const value = String(secret || '').trim();
    if (!value) this.storage?.removeItem?.(PUBLISH_SECRET_KEY);
    else this.storage?.setItem?.(PUBLISH_SECRET_KEY, value);
  }

  clearPublishSecret() {
    this.storage?.removeItem?.(PUBLISH_SECRET_KEY);
  }

  async _authorizedRequest(endpoint, options = {}) {
    let secret = this._publishSecret();
    if (!secret && typeof globalThis.prompt === 'function') {
      secret = String(globalThis.prompt('Dataset publish secret:') || '').trim();
      if (secret) this.setPublishSecret(secret);
    }
    if (!secret) throw new Error('Dataset publish secret is required');
    return request(endpoint, {
      ...options,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(options.headers || {}),
      },
    });
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

  async getRange(id, { from = null, to = null, offset = 0, limit = 5000 } = {}) {
    if (!id) throw new Error('Dataset id is required');
    const params = new URLSearchParams();
    if (from != null) params.set('from_time', String(from));
    if (to != null) params.set('to_time', String(to));
    params.set('offset', String(offset));
    params.set('limit', String(limit));
    const dataset = await request(`/${encodeURIComponent(id)}/range?${params}`);
    if (!dataset?.metadata || !Array.isArray(dataset.candles)) throw new Error('Remote dataset range is invalid');
    return dataset;
  }

  async getCsv(id) {
    if (!id) throw new Error('Dataset id is required');
    const dataset = await request(`/${encodeURIComponent(id)}/csv`);
    if (!dataset?.metadata || typeof dataset.csv !== 'string') throw new Error('Remote replay dataset is invalid');
    return { metadata: dataset.metadata, csv: dataset.csv };
  }

  async download({ symbol, timeframe, from, to, onProgress = null }) {
    const job = await this._authorizedRequest('/download', {
      method: 'POST',
      body: JSON.stringify({ symbol, timeframe, from, to }),
    });
    if (!job?.jobId) throw new Error('Dataset download job was not created');

    let state = job;
    while (!['complete', 'failed'].includes(state.status)) {
      onProgress?.(state);
      await sleep(1000);
      state = await request(`/downloads/${encodeURIComponent(job.jobId)}`);
    }
    onProgress?.(state);
    if (state.status !== 'complete') throw new Error(state.error || 'Dataset download failed');
    return state.dataset;
  }

  async save({ symbol, timeframe, from, to, candles, metadata = {} }) {
    return this._authorizedRequest('/publish', {
      method: 'POST',
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
    this.clearPublishSecret();
  }
}
