import { assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';
import { renderDataCenterPage } from './DataCenterView.js';

function toSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid start and end date');
  return Math.floor(ms / 1000);
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
    void this.render();
    return this;
  }

  _onClick = (event) => {
    const action = event.target.closest?.('[data-data-action]')?.dataset.dataAction;
    if (!action || !this._element?.contains(event.target)) return;
    const target = event.target.closest?.('[data-data-action]');
    const datasetId = target?.dataset?.datasetId;
    if (action === 'download' && this.pageName === 'downloads') void this.startDownload();
    else if (action === 'clear-current' && this.pageName === 'datasets') void this.clearCurrent();
    else if (action === 'validate' && this.pageName === 'validation') void this.validate();
    else if (action === 'delete-dataset' && datasetId) void this.deleteDataset(datasetId);
    else if (action === 'export-dataset' && datasetId) void this.exportDataset(datasetId);
    else if (action === 'open-replay' && datasetId) {
      globalThis.window?.dispatchEvent?.(new CustomEvent('select-replay-dataset', { detail: { datasetId } }));
      if (globalThis.window?.location) globalThis.window.location.hash = 'replay';
    }
  };

  async startDownload() {
    if (this.pageName !== 'downloads') return;
    const value = (id) => this._element?.querySelector(`#${id}`)?.value;
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
      this.session._validation = { status: 'error', message: errorMessage(error) };
    }
    await this.render();
  }

  async exportDataset(id) {
    try {
      const { metadata, csv } = await this.data.getDatasetCsv(id);
      if (!csv) throw new Error('Saved dataset is empty');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = this._element?.ownerDocument?.createElement('a');
      if (!anchor) throw new Error('Unable to create export link');
      anchor.href = url;
      anchor.download = metadata?.fileName || 'delta-replay-dataset.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      this.session._validation = { status: 'error', message: errorMessage(error) };
      await this.render();
    }
  }

  async render() {
    if (!this._initialized || !this._element) return;
    const token = ++this._renderToken;
    const sessionState = this.session.snapshot();
    const snapshot = this.data.snapshot();
    const storageEstimate = await this.data.storageEstimate();
    const savedDatasets = await this.data.listDatasets?.() || [];
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
    });
  }

  destroy() {
    if (!this._initialized) return;
    this._initialized = false;
    this._renderToken++;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._element?.removeEventListener('click', this._onClick);
    this._element = null;
  }
}
