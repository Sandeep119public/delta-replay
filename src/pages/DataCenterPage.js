import { assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';
import { renderDataCenterPage } from './DataCenterView.js';

function toSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid start and end date');
  return Math.floor(ms / 1000);
}

function triggerBrowserDownload(documentRef, fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'delta-replay-dataset.csv';
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class DataCenterPage {
  constructor(session, pageName = null) {
    if (!session?.data) throw new TypeError('data workspace session is required');
    this.session = session;
    this.data = assertDataWorkspacePort(session.data);
    this.pageName = pageName;
    this._element = null;
    this._unsubscribe = null;
    this._initialized = false;
    this._renderToken = 0;
  }

  mount(element, { pageName = this.pageName } = {}) {
    if (this._initialized) return this;
    if (!element) throw new Error('Data page element is required');
    if (!pageName) throw new Error('Data page name is required');
    this._element = element;
    this.pageName = pageName;
    this._initialized = true;
    this._unsubscribe = this.session.subscribe(() => { void this.render(); });
    this._element.addEventListener('click', this._onClick);
    this._element.addEventListener('change', this._onChange);
    void this.render();
    return this;
  }

  _onClick = (event) => {
    const target = event.target.closest?.('[data-data-action]');
    const action = target?.dataset?.dataAction;
    if (!action || !this._element?.contains(event.target)) return;
    const datasetId = target?.dataset?.datasetId;
    const source = target?.dataset?.datasetSource || 'github';
    if (action === 'download' && this.pageName === 'downloads') void this.startDownload();
    else if (action === 'cancel-download' && this.pageName === 'downloads') void this.session.cancelDownload?.();
    else if (action === 'open-local-file' && this.pageName === 'datasets') this._element.querySelector('#local-dataset-input')?.click();
    else if (action === 'clear-current' && this.pageName === 'datasets') void this.clearCurrent();
    else if (action === 'validate' && this.pageName === 'validation') void this.validate();
    else if (action === 'delete-dataset' && datasetId) void this.deleteDataset(datasetId);
    else if (action === 'delete-local-dataset' && datasetId) void this.deleteLocalDataset(datasetId);
    else if (action === 'export-dataset' && datasetId) void this.exportDataset(datasetId, source);
    else if (action === 'open-replay' && datasetId) {
      globalThis.window?.dispatchEvent?.(new CustomEvent('select-replay-dataset', {
        detail: { datasetId, source },
      }));
      if (globalThis.window?.location) globalThis.window.location.hash = 'replay';
    }
  };

  _onChange = (event) => {
    if (this.pageName !== 'datasets' || event.target?.id !== 'local-dataset-input') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void this.importLocalDataset(file);
  };

  async startDownload() {
    if (this.pageName !== 'downloads') return;
    const value = (id) => this._element?.querySelector('#' + id)?.value;
    const symbol = value('data-symbol')?.trim().toUpperCase();
    const timeframe = value('data-timeframe');
    try {
      const from = toSeconds(value('data-from'));
      const to = toSeconds(value('data-to'));
      if (!symbol || !timeframe) throw new Error('Symbol and timeframe are required');
      if (from >= to) throw new Error('End date must be after start date');
      await this.session.startDownload({ symbol, timeframe, from, to });
    } catch (error) {
      await this.session.startDownload({ symbol, timeframe, error: error?.message || String(error) });
    }
  }

  async importLocalDataset(file) {
    try {
      await this.session.importLocalDataset(file);
      if (globalThis.window?.location) globalThis.window.location.hash = 'replay';
    } catch (error) {
      this.session.setError?.(error?.message || String(error));
      await this.render();
    }
  }

  async clearCurrent() {
    if (this.pageName === 'datasets') await this.session.clearCurrent();
  }

  async validate() {
    if (this.pageName === 'validation') await this.session.validate();
  }

  async deleteDataset(id) {
    try {
      await this.data.deleteDataset(id);
    } catch (error) {
      this.session.setError?.(error?.message || String(error));
    }
    await this.render();
  }

  async deleteLocalDataset(id) {
    try {
      await this.data.deleteLocalDataset(id);
    } catch (error) {
      this.session.setError?.(error?.message || String(error));
    }
    await this.render();
  }

  async exportDataset(id, source = 'github') {
    try {
      const result = source === 'local'
        ? await this.data.getLocalDatasetCsv(id)
        : await this.data.getDatasetCsv(id);
      const metadata = result.metadata;
      if (!result.csv) throw new Error('Saved dataset is empty');
      const fallback = (metadata?.symbol || 'dataset') + '-' + (metadata?.timeframe || 'data') + '.csv';
      triggerBrowserDownload(this._element.ownerDocument, metadata?.fileName || fallback, result.csv, 'text/csv;charset=utf-8');
    } catch (error) {
      this.session.setError?.(error?.message || String(error));
      await this.render();
    }
  }

  async render() {
    if (!this._initialized || !this._element) return;
    const token = ++this._renderToken;
    const sessionState = this.session.snapshot();
    const snapshot = this.data.snapshot();
    const storageEstimate = await this.data.storageEstimate();
    const savedDatasets = this.pageName === 'datasets' ? await this.data.listDatasets() : [];
    const localDatasets = this.pageName === 'datasets' ? await this.data.listLocalDatasets() : [];
    if (!this._initialized || token !== this._renderToken) return;
    renderDataCenterPage({
      element: this._element,
      page: this.pageName,
      snapshot,
      storageEstimate,
      download: sessionState.download,
      jobsState: sessionState.jobs,
      validationState: sessionState.validation,
      savedDatasets,
      localDatasets,
    });
  }

  destroy() {
    if (!this._initialized) return;
    this._initialized = false;
    this._renderToken++;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._element?.removeEventListener('click', this._onClick);
    this._element?.removeEventListener('change', this._onChange);
    this._element = null;
  }
}
