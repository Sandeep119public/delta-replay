import { assertDataWorkspacePort } from '../ports/DataWorkspacePort.js';
import { renderDataCenterPage } from './DataCenterView.js';

function toSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid start and end date');
  return Math.floor(ms / 1000);
}

export class DataCenterPage {
  constructor(session, pageName, { documentRef = globalThis.document } = {}) {
    if (!session?.data) throw new TypeError('data workspace session is required');
    this.session = session;
    this.data = assertDataWorkspacePort(session.data);
    this.pageName = pageName;
    this.document = documentRef;
    this._element = null;
    this._unsubscribe = null;
    this._initialized = false;
    this._renderToken = 0;
  }

  mount(element) {
    if (this._initialized) return this;
    if (!element) throw new Error(`Page element #page-${this.pageName} is required`);
    this._element = element;
    this._initialized = true;
    this._unsubscribe = this.session.subscribe(() => { void this.render(); });
    this._element.addEventListener('click', this._onClick);
    void this.render();
    return this;
  }

  _onClick = (event) => {
    const action = event.target.closest?.('[data-data-action]')?.dataset.dataAction;
    if (!action || !this._element?.contains(event.target)) return;
    if (action === 'download' && this.pageName === 'downloads') void this.startDownload();
    else if (action === 'clear-current' && this.pageName === 'datasets') void this.clearCurrent();
    else if (action === 'validate' && this.pageName === 'validation') void this.validate();
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

  async render() {
    if (!this._initialized || !this._element) return;
    const token = ++this._renderToken;
    const sessionState = this.session.snapshot();
    const snapshot = this.data.snapshot();
    const storageEstimate = await this.data.storageEstimate();
    if (!this._initialized || token !== this._renderToken) return;
    renderDataCenterPage({
      documentRef: this.document,
      page: this.pageName,
      snapshot,
      storageEstimate,
      download: sessionState.download,
      jobsState: sessionState.jobs,
      validationState: sessionState.validation,
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
