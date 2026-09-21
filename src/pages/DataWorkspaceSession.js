import { assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';

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
    this._destroyed = false;
    this._initialized = false;
  }

  init() {
    if (this._destroyed || this._initialized) return this;
    this._initialized = true;
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
      this._job('Binance dataset download', 'failed');
      this._notify();
      return;
    }

    const countHint = params?.from != null && params?.to != null ? 0 : 0;
    this._download = {
      status: 'running',
      loaded: 0,
      total: countHint,
      pct: 0,
      error: null,
      ...params,
    };
    this._job('Binance dataset download', 'running');
    this._notify();

    try {
      const manifest = await this.data.download(params);
      const count = Number(manifest?.count || 0);
      this._download = {
        ...this._download,
        status: 'complete',
        loaded: count,
        total: count,
        pct: 100,
        error: null,
        manifest,
      };
      this._job('Binance dataset download', 'complete', 100);
    } catch (error) {
      this._download = { ...this._download, status: 'failed', error: errorMessage(error) };
      this._job('Binance dataset download', 'failed');
    }
    this._notify();
  }

  async clearCurrent() {
    try {
      await this.data.clearCurrent();
      this._job('Clear browser replay cache', 'complete', 100);
    } catch (error) {
      this._job('Clear browser replay cache', 'failed');
      this._download = { ...this._download, error: errorMessage(error) };
    }
    this._notify();
  }

  async validate() {
    try {
      this._validation = await this.data.validateCurrent();
      this._job('Replay dataset validation', 'complete', 100);
    } catch (error) {
      this._validation = { status: 'error', message: errorMessage(error) };
      this._job('Replay dataset validation', 'failed');
    }
    this._notify();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._listeners.clear();
  }
}
