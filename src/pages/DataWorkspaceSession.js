import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

function errorMessage(error) {
  return error?.message || String(error);
}

export class DataWorkspaceSession {
  constructor(dataWorkspace) {
    this.data = assertDataWorkspacePort(dataWorkspace);
    this._download = { status: 'idle', loaded: 0, total: 0, pct: 0, error: null };
    this._validation = null;
    this._jobs = [];
    this._listeners = new Set();
    this._unbind = [];
    this._destroyed = false;
    this._initialized = false;
  }

  init() {
    if (this._destroyed || this._initialized) return this;
    this._initialized = true;
    const subscribe = (event, handler) => this._unbind.push(this.data.on(event, handler));
    subscribe(DATA_WORKSPACE_EVENTS.LOADING_STARTED, (progress) => {
      this._download = { status: 'running', loaded: 0, total: 0, pct: 0, error: null, ...progress };
      this._job('Historical data download', 'running');
      this._notify();
    });
    subscribe(DATA_WORKSPACE_EVENTS.PROGRESS, (progress) => {
      this._download = { ...this._download, status: 'running', ...progress };
      this._job('Historical data download', 'running', progress?.pct);
      this._notify();
    });
    subscribe(DATA_WORKSPACE_EVENTS.READY, (payload) => {
      const count = payload?.dataset?.count ?? payload?.candles?.length ?? this._download.loaded;
      this._download = { ...this._download, status: 'complete', loaded: count, total: payload?.dataset?.count ?? payload?.candles?.length ?? this._download.total, pct: 100, error: null };
      this._job('Historical data download', 'complete', 100);
      this._notify();
    });
    subscribe(DATA_WORKSPACE_EVENTS.READY_DEGRADED, (payload) => {
      const count = payload?.candles?.length ?? 0;
      this._download = { ...this._download, status: 'degraded', loaded: count, total: count, pct: 100 };
      this._job('Historical data download', 'degraded', 100);
      this._notify();
    });
    subscribe(DATA_WORKSPACE_EVENTS.ERROR, (error) => {
      this._download = { ...this._download, status: 'failed', error: errorMessage(error) };
      this._job('Historical data download', 'failed');
      this._notify();
    });
    return this;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (this._destroyed) return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  snapshot() {
    return Object.freeze({
      download: { ...this._download },
      validation: this._validation ? { ...this._validation } : null,
      jobs: this._jobs.map((job) => ({ ...job })),
    });
  }

  setError(message) {
    this._validation = { status: 'error', message: errorMessage({ message }) };
    this._notify();
  }

  _notify() {
    for (const listener of [...this._listeners]) listener(this.snapshot());
  }

  _job(name, status, progress = null) {
    const job = this._jobs.find((item) => item.name === name);
    if (job) Object.assign(job, { status, ...(progress == null ? {} : { progress }) });
    else this._jobs.unshift({ name, status, progress: progress ?? 0 });
    this._jobs = this._jobs.slice(0, 12);
  }

  async startDownload(params) {
    if (['running', 'starting'].includes(this._download.status)) return;
    if (params?.error) {
      this._download = { ...this._download, ...params, status: 'failed', error: params.error };
      this._job('Historical data download', 'failed');
      this._notify();
      return;
    }
    this._download = { status: 'starting', loaded: 0, total: 0, pct: 0, error: null, ...params };
    this._notify();
    try {
      await this.data.download(params);
    } catch (error) {
      this._download = { ...this._download, status: 'failed', error: errorMessage(error) };
      this._job('Historical data download', 'failed');
      this._notify();
    }
  }

  async cancelDownload() {
    if (!this._download.jobId || !['running', 'starting'].includes(this._download.status)) return;
    try {
      await this.data.cancelDownload(this._download.jobId);
      this._download = { ...this._download, status: 'cancelled', error: 'Download cancelled' };
      this._job('Historical data download', 'cancelled', this._download.pct);
    } catch (error) {
      this._download = { ...this._download, error: errorMessage(error) };
      this._job('Historical data download', 'failed');
    }
    this._notify();
  }

  async clearCurrent() {
    try {
      await this.data.clearCurrent();
      this._job('Clear current dataset', 'complete', 100);
    } catch (error) {
      this._job('Clear current dataset', 'failed');
      this._download = { ...this._download, error: errorMessage(error) };
    }
    this._notify();
  }

  async validate() {
    try {
      this._validation = await this.data.validateCurrent();
      this._job('Dataset validation', 'complete', 100);
    } catch (error) {
      this._validation = { status: 'error', message: errorMessage(error) };
      this._job('Dataset validation', 'failed');
    }
    this._notify();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    for (const off of this._unbind.splice(0)) {
      try { off?.(); } catch { /* continue cleanup */ }
    }
    this._listeners.clear();
  }
}
