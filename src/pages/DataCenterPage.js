import { DATA_WORKSPACE_EVENTS, assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';
import { renderDataCenterPages } from './DataCenterView.js';

function toSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid start and end date');
  return Math.floor(ms / 1000);
}

function errorMessage(error) {
  return error?.message || String(error);
}

export class DataCenterPage {
  constructor(dataWorkspace, { documentRef = globalThis.document } = {}) {
    this.data = assertDataWorkspacePort(dataWorkspace);
    this.document = documentRef;
    this._destroyed = false;
    this._initialized = false;
    this._unbind = [];
    this._download = { status: 'idle', loaded: 0, total: 0, pct: 0, error: null };
    this._validation = null;
    this._jobs = [];
    this._renderToken = 0;
  }

  init() {
    if (this._destroyed || this._initialized) return this;
    this._initialized = true;
    const subscribe = (event, handler) => this._unbind.push(this.data.on(event, handler));
    subscribe(DATA_WORKSPACE_EVENTS.LOADING_STARTED, (progress) => {
      this._download = { status: 'running', loaded: 0, total: 0, pct: 0, error: null, ...progress };
      this._job('Historical data download', 'running');
      void this.render();
    });
    subscribe(DATA_WORKSPACE_EVENTS.PROGRESS, (progress) => {
      this._download = { ...this._download, status: 'running', ...progress };
      this._job('Historical data download', 'running', progress?.pct);
      void this.render();
    });
    subscribe(DATA_WORKSPACE_EVENTS.READY, (payload) => {
      const count = payload?.candles?.length ?? this._download.loaded;
      this._download = { ...this._download, status: 'complete', loaded: count, total: payload?.candles?.length ?? this._download.total, pct: 100, error: null };
      this._job('Historical data download', 'complete', 100);
      void this.render();
    });
    subscribe(DATA_WORKSPACE_EVENTS.READY_DEGRADED, (payload) => {
      const count = payload?.candles?.length ?? 0;
      this._download = { ...this._download, status: 'degraded', loaded: count, total: count, pct: 100 };
      this._job('Historical data download', 'degraded', 100);
      void this.render();
    });
    subscribe(DATA_WORKSPACE_EVENTS.ERROR, (error) => {
      this._download = { ...this._download, status: 'failed', error: errorMessage(error) };
      this._job('Historical data download', 'failed');
      void this.render();
    });

    const onClick = (event) => {
      const action = event.target.closest?.('[data-data-action]')?.dataset.dataAction;
      if (action === 'download') void this.startDownload();
      else if (action === 'clear-current') void this.clearCurrent();
      else if (action === 'validate') void this.validate();
    };
    this.document.addEventListener('click', onClick);
    this._unbind.push(() => this.document.removeEventListener('click', onClick));
    void this.render();
    return this;
  }

  _job(name, status, progress = null) {
    const job = this._jobs.find((item) => item.name === name);
    if (job) Object.assign(job, { status, ...(progress == null ? {} : { progress }) });
    else this._jobs.unshift({ name, status, progress: progress ?? 0 });
    this._jobs = this._jobs.slice(0, 12);
  }

  async startDownload() {
    if (['running', 'starting'].includes(this._download.status)) return;
    const symbol = this.document.getElementById('data-symbol')?.value?.trim().toUpperCase();
    const timeframe = this.document.getElementById('data-timeframe')?.value;
    try {
      const from = toSeconds(this.document.getElementById('data-from')?.value);
      const to = toSeconds(this.document.getElementById('data-to')?.value);
      if (!symbol || !timeframe) throw new Error('Symbol and timeframe are required');
      if (from >= to) throw new Error('End date must be after start date');
      this._download = { status: 'starting', loaded: 0, total: 0, pct: 0, error: null, symbol, timeframe, from, to };
      await this.render();
      await this.data.download({ symbol, timeframe, from, to });
    } catch (error) {
      this._download = { ...this._download, status: 'failed', error: errorMessage(error) };
      this._job('Historical data download', 'failed');
      await this.render();
    }
  }

  async clearCurrent() {
    try {
      await this.data.clearCurrent();
      this._job('Clear current dataset', 'complete', 100);
      await this.render();
    } catch (error) {
      this._job('Clear current dataset', 'failed');
      this._download = { ...this._download, error: errorMessage(error) };
      await this.render();
    }
  }

  async validate() {
    try {
      this._validation = await this.data.validateCurrent();
      this._job('Dataset validation', 'complete', 100);
    } catch (error) {
      this._validation = { status: 'error', message: errorMessage(error) };
      this._job('Dataset validation', 'failed');
    }
    await this.render();
  }

  async render() {
    if (this._destroyed) return;
    const token = ++this._renderToken;
    const snapshot = this.data.snapshot();
    const storageEstimate = await this.data.storageEstimate();
    if (this._destroyed || token !== this._renderToken) return;
    renderDataCenterPages({
      documentRef: this.document,
      snapshot,
      storageEstimate,
      download: this._download,
      jobsState: this._jobs,
      validationState: this._validation,
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._initialized = false;
    this._renderToken++;
    for (const off of this._unbind.splice(0)) {
      try { off?.(); } catch { /* cleanup must not block remaining teardown */ }
    }
  }
}
