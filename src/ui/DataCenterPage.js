import { DataEvents } from '../data/HistoricalDataManager.js';
import { CandleIntegrity } from '../data/CandleIntegrity.js';

const PAGE_NAMES = ['dashboard', 'downloads', 'datasets', 'validation', 'storage', 'experiments', 'strategies', 'journal', 'jobs', 'system'];

function toSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Choose a valid start and end date');
  return Math.floor(ms / 1000);
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export class DataCenterPage {
  constructor({ dataManager, candleStore, candleCache, appState }) {
    this.dataManager = dataManager;
    this.candleStore = candleStore;
    this.candleCache = candleCache;
    this.appState = appState;
    this._destroyed = false;
    this._unbind = [];
    this._download = { status: 'idle', loaded: 0, total: 0, pct: 0, error: null, startedAt: null };
    this._jobs = [];
  }

  init() {
    if (this._destroyed) return;
    this._unbind.push(this.dataManager.on(DataEvents.LOADING_STARTED, (payload) => {
      this._download = { status: 'running', loaded: 0, total: 0, pct: 0, error: null, startedAt: Date.now(), ...payload };
      this._upsertJob('Historical data download', 'running');
      this.render();
    }));
    this._unbind.push(this.dataManager.on(DataEvents.PROGRESS, ({ loaded = 0, total = 0, pct = 0 } = {}) => {
      this._download = { ...this._download, status: 'running', loaded, total, pct };
      this._upsertJob('Historical data download', 'running', pct);
      this.render();
    }));
    this._unbind.push(this.dataManager.on(DataEvents.READY, ({ candles = [] } = {}) => {
      this._download = { ...this._download, status: 'complete', loaded: candles.length, total: candles.length, pct: 100, error: null };
      this._upsertJob('Historical data download', 'complete', 100);
      this.render();
    }));
    this._unbind.push(this.dataManager.on(DataEvents.READY_DEGRADED, ({ candles = [] } = {}) => {
      this._download = { ...this._download, status: 'degraded', loaded: candles.length, total: candles.length, pct: 100 };
      this._upsertJob('Historical data download', 'degraded', 100);
      this.render();
    }));
    this._unbind.push(this.dataManager.on(DataEvents.ERROR, (error) => {
      this._download = { ...this._download, status: 'failed', error: error?.message || String(error) };
      this._upsertJob('Historical data download', 'failed');
      this.render();
    }));
    this._bindNavigationActions();
    this.render();
  }

  _upsertJob(name, status, progress = null) {
    const existing = this._jobs.find((job) => job.name === name);
    if (existing) Object.assign(existing, { status, ...(progress == null ? {} : { progress }) });
    else this._jobs.unshift({ name, status, progress: progress ?? 0, at: Date.now() });
    this._jobs = this._jobs.slice(0, 12);
  }

  _bindNavigationActions() {
    const onClick = (event) => {
      const action = event.target.closest?.('[data-data-action]');
      if (!action) return;
      const name = action.dataset.dataAction;
      if (name === 'download') this.startDownload();
      if (name === 'clear-current') this.clearCurrentDataset();
      if (name === 'validate') this.validateCurrentDataset();
      if (name === 'refresh') this.render();
    };
    document.addEventListener('click', onClick);
    this._unbind.push(() => document.removeEventListener('click', onClick));
  }

  async startDownload() {
    if (this._download.status === 'running') return;
    const symbol = document.getElementById('data-symbol')?.value?.trim().toUpperCase();
    const timeframe = document.getElementById('data-timeframe')?.value;
    const fromValue = document.getElementById('data-from')?.value;
    const toValue = document.getElementById('data-to')?.value;
    try {
      const from = toSeconds(fromValue);
      const to = toSeconds(toValue);
      if (!symbol || !timeframe) throw new Error('Symbol and timeframe are required');
      if (from >= to) throw new Error('End date must be after start date');
      this._download = { status: 'starting', loaded: 0, total: 0, pct: 0, error: null, startedAt: Date.now(), symbol, timeframe, from, to };
      this.render();
      await this.dataManager.load({ symbol, timeframe, from, to, strict: true });
    } catch (error) {
      this._download = { ...this._download, status: 'failed', error: error?.message || String(error) };
      this._upsertJob('Historical data download', 'failed');
      this.render();
    }
  }

  async clearCurrentDataset() {
    const symbol = this.candleStore.getSymbol() || document.getElementById('data-symbol')?.value?.trim().toUpperCase();
    const timeframe = this.candleStore.getTimeframe() || document.getElementById('data-timeframe')?.value;
    if (!symbol || !timeframe) return;
    try {
      this.candleCache.invalidate(symbol, timeframe);
      this.candleStore.clear();
      this._upsertJob('Clear current dataset', 'complete', 100);
      this.render();
    } catch (error) {
      this._upsertJob('Clear current dataset', 'failed');
      this._download = { ...this._download, error: error?.message || String(error) };
      this.render();
    }
  }

  validateCurrentDataset() {
    const candles = this.candleStore.getAll();
    const metadata = this.candleStore.getMetadata();
    if (!candles.length) {
      this._validation = { status: 'empty', message: 'No dataset is currently loaded.' };
    } else {
      const timeframe = metadata?.timeframe;
      const options = { timeframeSec: metadata?.timeframeSec, from: metadata?.effectiveFrom, to: metadata?.effectiveTo, policy: 'REPAIR', timestampUnit: 'seconds' };
      const result = CandleIntegrity.process(candles, options);
      this._validation = { status: result.metadata.invalidCount === 0 && result.metadata.gaps.length === 0 ? 'valid' : 'issues', metadata: result.metadata };
    }
    this._upsertJob('Dataset validation', 'complete', 100);
    this.render();
  }

  _currentCoverage() {
    const symbol = this.candleStore.getSymbol() || document.getElementById('data-symbol')?.value?.trim().toUpperCase();
    const timeframe = this.candleStore.getTimeframe() || document.getElementById('data-timeframe')?.value;
    if (!symbol || !timeframe) return [];
    return this.candleCache.getCoverage(symbol, timeframe, { timeframeSec: this.candleStore.getMetadata()?.timeframeSec });
  }

  _storageSnapshot() {
    const usage = globalThis.navigator?.storage?.estimate;
    if (!usage) return Promise.resolve(null);
    return usage.call(globalThis.navigator.storage).catch(() => null);
  }

  async render() {
    if (this._destroyed) return;
    const current = this.candleStore.getMetadata() || {};
    const coverage = this._currentCoverage();
    const storage = await this._storageSnapshot();
    if (this._destroyed) return;

    const defaults = this._dateDefaults();
    const symbol = this.candleStore.getSymbol() || this.appState.symbol || 'SOLUSDT';
    const timeframe = this.candleStore.getTimeframe() || this.appState.timeframe || '15m';
    this._setPage('dashboard', this._dashboardMarkup(current, coverage, storage));
    this._setPage('downloads', this._downloadsMarkup(symbol, timeframe, defaults));
    this._setPage('datasets', this._datasetsMarkup(current, coverage));
    this._setPage('validation', this._validationMarkup(current));
    this._setPage('storage', this._storageMarkup(storage));
    this._setPage('experiments', this._comingSoon('Experiments', 'Experiment orchestration will consume the dataset and job contracts created here.'));
    this._setPage('strategies', this._comingSoon('Strategies', 'Strategy definitions and walk-forward results will live here.'));
    this._setPage('journal', this._comingSoon('Journal', 'Replay notes and research observations will be added here.'));
    this._setPage('jobs', this._jobsMarkup());
    this._setPage('system', this._systemMarkup());
  }

  _dateDefaults() {
    const now = new Date();
    const end = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const start = new Date(end.getTime() - 30 * 86400000);
    return { start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) };
  }

  _setPage(name, html) {
    const el = document.getElementById(`page-${name}`);
    if (el) el.replaceChildren(...this._fragment(html));
  }

  _fragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return [...template.content.childNodes];
  }

  _pageHeader(eyebrow, title, subtitle) { return `<header class="data-page-header"><div><span class="data-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div></header>`; }
  _card(label, value, detail = '') { return `<article class="data-card"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</article>`; }

  _dashboardMarkup(meta, coverage, storage) {
    const count = this.candleStore.getCount();
    const used = storage?.usage != null ? `${(storage.usage / 1073741824).toFixed(2)} GB` : 'Unavailable';
    return `<div class="data-page">${this._pageHeader('WORKSPACE', 'Overview', 'A control room for market data, replay state and research jobs.')}
      <div class="data-card-grid">${this._card('Loaded candles', count.toLocaleString())}${this._card('Current dataset', meta.symbol ? `${escapeText(meta.symbol)} · ${escapeText(meta.timeframe)}` : 'None')}${this._card('Cache coverage', coverage.length ? `${coverage.length} interval${coverage.length === 1 ? '' : 's'}` : 'No cached coverage')}${this._card('Browser storage', used)}</div>
      <section class="data-panel"><div class="data-panel-head"><div><span class="data-eyebrow">Quick actions</span><h2>Data workflow</h2></div></div><div class="data-action-grid"><a href="#downloads">Download historical data</a><a href="#datasets">Manage datasets</a><a href="#validation">Validate current data</a><a href="#storage">Inspect storage</a></div></section>
      <section class="data-panel"><div class="data-panel-head"><div><span class="data-eyebrow">Current state</span><h2>Replay dataset</h2></div></div><dl class="data-detail-grid"><div><dt>Symbol</dt><dd>${escapeText(meta.symbol || 'None')}</dd></div><div><dt>Timeframe</dt><dd>${escapeText(meta.timeframe || 'None')}</dd></div><div><dt>Rows</dt><dd>${count.toLocaleString()}</dd></div><div><dt>Quality</dt><dd>${escapeText(meta.quality || 'Unknown')}</dd></div></dl></section></div>`;
  }

  _downloadsMarkup(symbol, timeframe, defaults) {
    const d = this._download;
    const error = d.error ? `<div class="data-alert error" role="alert">${escapeText(d.error)}</div>` : '';
    const progress = ['running', 'starting'].includes(d.status) ? `<div class="download-progress"><div class="progress-track"><span style="width:${Math.max(0, Math.min(100, Number(d.pct) || 0))}%"></span></div><div><strong>${Number(d.pct || 0).toFixed(0)}%</strong><span>${Number(d.loaded || 0).toLocaleString()} / ${Number(d.total || 0).toLocaleString()} candles</span></div></div>` : '';
    return `<div class="data-page">${this._pageHeader('DATA / DOWNLOADS', 'Download Center', 'Fetch validated historical candles into the shared replay cache.')}${error}
      <section class="data-panel"><form id="download-form" class="data-form" novalidate><label>Symbol<input id="data-symbol" value="${escapeText(symbol)}" autocomplete="off" spellcheck="false"></label><label>Timeframe<select id="data-timeframe">${['1m','5m','15m','30m','1h','4h','1d'].map(tf => `<option value="${tf}" ${tf === timeframe ? 'selected' : ''}>${tf}</option>`).join('')}</select></label><label>Start<input id="data-from" type="datetime-local" value="${defaults.start}"></label><label>End<input id="data-to" type="datetime-local" value="${defaults.end}"></label><button class="data-primary" type="button" data-data-action="download" ${d.status === 'running' || d.status === 'starting' ? 'disabled' : ''}>${d.status === 'complete' ? 'Download again' : 'Start download'}</button></form>${progress}<p class="data-note">Downloads are validated and cached through the existing HistoricalDataManager. A successful download becomes available to Replay immediately.</p></section>
      <section class="data-panel"><div class="data-panel-head"><div><span class="data-eyebrow">Lifecycle</span><h2>What happens</h2></div></div><ol class="data-steps"><li>Normalize the requested candle range.</li><li>Reuse clean IndexedDB/memory coverage where possible.</li><li>Fetch missing ranges with retry and integrity checks.</li><li>Publish the validated dataset to Replay.</li></ol></section></div>`;
  }

  _datasetsMarkup(meta, coverage) {
    const ranges = coverage.length ? coverage.map((iv) => `<tr><td>${new Date(iv.from * 1000).toISOString()}</td><td>${new Date(iv.to * 1000).toISOString()}</td><td>${escapeText(meta.timeframe || '—')}</td></tr>`).join('') : `<tr><td colspan="3">No cached coverage for the current dataset.</td></tr>`;
    return `<div class="data-page">${this._pageHeader('DATA / DATASETS', 'Dataset Manager', 'Inspect the active dataset and the cache coverage that backs it.')}
      <section class="data-panel"><div class="data-card-grid compact">${this._card('Symbol', escapeText(meta.symbol || 'None'))}${this._card('Timeframe', escapeText(meta.timeframe || 'None'))}${this._card('Rows', this.candleStore.getCount().toLocaleString())}${this._card('Quality', escapeText(meta.quality || 'Unknown'))}</div></section>
      <section class="data-panel"><div class="data-panel-head"><div><span class="data-eyebrow">Coverage</span><h2>Cached intervals</h2></div><button type="button" data-data-action="clear-current">Clear current dataset</button></div><div class="data-table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Timeframe</th></tr></thead><tbody>${ranges}</tbody></table></div></section></div>`;
  }

  _validationMarkup(meta) {
    const v = this._validation;
    const count = this.candleStore.getCount();
    const status = v?.status || (meta.quality === 'VALID' ? 'valid' : count ? 'not-run' : 'empty');
    const label = status === 'valid' ? 'VALID' : status === 'issues' ? 'ISSUES FOUND' : status === 'empty' ? 'NO DATA' : 'NOT RUN';
    const detail = v?.metadata ? `Invalid: ${v.metadata.invalidCount ?? 0} · Gaps: ${v.metadata.gaps?.length ?? 0}` : 'Run validation against the active candle store.';
    return `<div class="data-page">${this._pageHeader('DATA / VALIDATION', 'Data Quality', 'Make dataset integrity visible before research consumes it.')}
      <section class="data-panel validation-card"><div class="validation-status ${status}"><span>${label}</span><strong>${count.toLocaleString()} candles</strong><small>${escapeText(detail)}</small></div><button class="data-primary" type="button" data-data-action="validate">Validate current dataset</button></section>
      <section class="data-panel"><h2>Validation contract</h2><p>Timestamp ordering, candle validity, timeframe alignment and coverage gaps are checked using the same integrity layer used by historical loading.</p></section></div>`;
  }

  _storageMarkup(storage) {
    const usage = storage?.usage ?? null;
    const quota = storage?.quota ?? null;
    const pct = usage && quota ? (usage / quota) * 100 : null;
    return `<div class="data-page">${this._pageHeader('DATA / STORAGE', 'Storage', 'Understand how much browser storage is available to the replay cache.')}
      <div class="data-card-grid">${this._card('Used', usage != null ? `${(usage / 1073741824).toFixed(2)} GB` : 'Unavailable')}${this._card('Quota', quota != null ? `${(quota / 1073741824).toFixed(2)} GB` : 'Unavailable')}${this._card('Usage', pct != null ? `${pct.toFixed(1)}%` : 'Unavailable')}${this._card('Cache', this.candleCache.enableIDB ? 'IndexedDB enabled' : 'Memory only')}</div>
      <section class="data-panel"><h2>Storage policy</h2><p>Dataset persistence belongs to CandleCache. This page reports browser capacity rather than pretending the web application controls the operating system filesystem.</p></section></div>`;
  }

  _jobsMarkup() {
    const rows = this._jobs.length ? this._jobs.map(job => `<tr><td>${escapeText(job.name)}</td><td><span class="job-status ${job.status}">${escapeText(job.status)}</span></td><td>${job.progress != null ? `${Number(job.progress).toFixed(0)}%` : '—'}</td></tr>`).join('') : '<tr><td colspan="3">No jobs have run in this session.</td></tr>';
    return `<div class="data-page">${this._pageHeader('SYSTEM / JOBS', 'Jobs', 'A lightweight audit trail for data operations started in this browser session.')}<section class="data-panel"><div class="data-table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
  }

  _systemMarkup() {
    const idb = this.candleCache.enableIDB;
    return `<div class="data-page">${this._pageHeader('SYSTEM', 'System', 'Runtime capabilities and data-service health.')}
      <div class="data-card-grid">${this._card('Replay data service', 'Ready')}${this._card('IndexedDB', idb ? 'Available' : 'Unavailable')}${this._card('Candle store', `${this.candleStore.getCount().toLocaleString()} rows`)}${this._card('Session', 'Browser local')}</div>
      <section class="data-panel"><h2>Architecture</h2><p>UI actions flow through HistoricalDataManager, which owns range normalization, cache reuse, fetching, retries and integrity publication. The pages do not reach into provider internals.</p></section></div>`;
  }

  _comingSoon(title, detail) { return `<div class="data-page">${this._pageHeader('RESEARCH', title, detail)}<section class="data-panel empty-page"><strong>Workspace reserved</strong><p>The navigation is established now so future research features can attach to the same page and job contracts without another shell rewrite.</p></section></div>`; }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const off of this._unbind.splice(0)) { try { off?.(); } catch {} }
  }
}