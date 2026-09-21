export class MarketModeController {
  constructor({
    page,
    liveButton,
    replayButton,
    datasetSelect,
    datasetRefresh,
    symbolSelect,
    timeframeSelect,
    controls,
    appState,
    liveMarket,
    datasetRepository,
    localDatasetRepository = null,
    replayCapabilities,
    chartManager = null,
    pauseReplay = null,
    dataStatus = null,
  } = {}) {
    if (!page || !appState || !liveMarket || !datasetRepository || !localDatasetRepository || !replayCapabilities) {
      throw new TypeError('MarketModeController requires page, appState, liveMarket, datasetRepository, localDatasetRepository and replayCapabilities');
    }
    this.page = page;
    this.liveButton = liveButton;
    this.replayButton = replayButton;
    this.datasetSelect = datasetSelect;
    this.datasetRefresh = datasetRefresh;
    this.symbolSelect = symbolSelect;
    this.timeframeSelect = timeframeSelect;
    this.controls = controls;
    this.appState = appState;
    this.liveMarket = liveMarket;
    this.datasetRepository = datasetRepository;
    this.localDatasetRepository = localDatasetRepository;
    this.replayCapabilities = replayCapabilities;
    this.chartManager = chartManager;
    this.pauseReplay = pauseReplay;
    this.dataStatus = dataStatus;
    this.mode = 'live';
    this.destroyed = false;
    this._listeners = [];
    this._pageChangeHandler = (event) => {
      if (this.destroyed) return;
      if (event?.detail?.page === 'replay') {
        if (this.mode !== 'replay') void this.setMode('replay');
        else void this.refreshDatasets();
      } else {
        this.liveMarket.stop();
      }
    };
    this._datasetChangedHandler = () => {
      if (this.mode === 'replay') void this.refreshDatasets();
    };
    this._localDatasetChangedHandler = () => {
      if (this.mode === 'replay') void this.refreshDatasets();
    };
    this._selectReplayDatasetHandler = (event) => {
      const datasetId = event?.detail?.datasetId;
      const source = event?.detail?.source || 'github';
      if (!datasetId) return;
      void this.setMode('replay').then(() => this.selectDataset(source + ':' + datasetId));
    };

    this._listen(this.liveButton, 'click', () => { void this.setMode('live'); });
    this._listen(this.replayButton, 'click', () => { void this.setMode('replay'); });
    this._listen(this.datasetRefresh, 'click', () => { void this.refreshDatasets(); });
    this._listen(this.datasetSelect, 'change', () => {
      void this.selectDataset(this.datasetSelect?.value);
    });
    globalThis.window?.addEventListener?.('pagechange', this._pageChangeHandler);
    globalThis.window?.addEventListener?.('delta-replay-datasets-changed', this._datasetChangedHandler);
    globalThis.window?.addEventListener?.('delta-replay-local-datasets-changed', this._localDatasetChangedHandler);
    globalThis.window?.addEventListener?.('select-replay-dataset', this._selectReplayDatasetHandler);
  }

  _listen(element, event, handler) {
    if (!element?.addEventListener) return;
    element.addEventListener(event, handler);
    this._listeners.push([element, event, handler]);
  }

  _setStatus(text) {
    if (this.dataStatus) this.dataStatus.textContent = text;
  }

  _syncButtons() {
    const replay = this.mode === 'replay';
    this.liveButton?.classList.toggle('active', !replay);
    this.replayButton?.classList.toggle('active', replay);
    this.liveButton?.setAttribute('aria-pressed', String(!replay));
    this.replayButton?.setAttribute('aria-pressed', String(replay));
    this.symbolSelect && (this.symbolSelect.disabled = replay);
    this.timeframeSelect && (this.timeframeSelect.disabled = replay);
    this.datasetSelect && (this.datasetSelect.disabled = !replay || this.datasetSelect.options.length === 0);
    this.datasetRefresh && (this.datasetRefresh.disabled = !replay);
    this.page.classList.toggle('live-mode', !replay);
    this.page.classList.toggle('replay-mode', replay);
    this.controls?.setEnabledForPreview(false);
  }

  _parseSelection(value) {
    const raw = String(value || '');
    const separator = raw.indexOf(':');
    if (separator < 0) return { source: 'github', id: raw };
    return { source: raw.slice(0, separator), id: raw.slice(separator + 1) };
  }

  async setMode(mode, { force = false } = {}) {
    if (this.destroyed) return;
    if (mode !== 'live' && mode !== 'replay') throw new TypeError('Unknown market mode: ' + mode);
    if (!force && this.mode === mode) return;

    this.mode = mode;
    this.appState.setMode(mode);
    this._syncButtons();

    if (mode === 'live') {
      await this.pauseReplay?.();
      this.liveMarket.stop();
      this._setStatus('LIVE · connecting…');
      try {
        await this.liveMarket.start({ symbol: this.appState.symbol, timeframe: this.appState.timeframe });
      } catch (error) {
        this._setStatus('LIVE · ' + (error?.message || 'connection error'));
      }
      return;
    }

    this.liveMarket.stop();
    this.chartManager?.clear?.();
    this.chartManager?.setRevealedMax?.(null);
    this._setStatus('REPLAY · selecting dataset…');
    await this.refreshDatasets();
  }

  async refreshDatasets() {
    if (this.destroyed || this.mode !== 'replay') return;
    const [datasets, localDatasets] = await Promise.all([
      this.datasetRepository.list(),
      this.localDatasetRepository.list(),
    ]);

    if (this.datasetSelect) {
      this.datasetSelect.replaceChildren();
      if (!datasets.length && !localDatasets.length) {
        const option = this.page.ownerDocument?.createElement?.('option') || globalThis.document?.createElement?.('option');
        option.value = '';
        option.textContent = 'No datasets';
        this.datasetSelect.appendChild(option);
      } else {
        if (datasets.length) {
          const group = this.page.ownerDocument?.createElement?.('optgroup') || globalThis.document?.createElement?.('optgroup');
          group.label = 'GitHub';
          for (const dataset of datasets) {
            const option = this.page.ownerDocument?.createElement?.('option') || globalThis.document?.createElement?.('option');
            option.value = 'github:' + dataset.id;
            option.textContent = dataset.symbol + ' · ' + dataset.timeframe + ' · ' + Number(dataset.count || 0).toLocaleString() + ' · GitHub';
            group.appendChild(option);
          }
          this.datasetSelect.appendChild(group);
        }
        if (localDatasets.length) {
          const group = this.page.ownerDocument?.createElement?.('optgroup') || globalThis.document?.createElement?.('optgroup');
          group.label = 'Browser local';
          for (const dataset of localDatasets) {
            const option = this.page.ownerDocument?.createElement?.('option') || globalThis.document?.createElement?.('option');
            option.value = 'local:' + dataset.id;
            option.textContent = dataset.symbol + ' · ' + dataset.timeframe + ' · ' + Number(dataset.count || 0).toLocaleString() + ' · Local';
            group.appendChild(option);
          }
          this.datasetSelect.appendChild(group);
        }
      }
    }

    if (!datasets.length && !localDatasets.length) {
      this.chartManager?.clear?.();
      this._setStatus('REPLAY · no dataset · use Downloads or Open local CSV');
      this.controls?.setEnabledForPreview(false);
      return;
    }

    const current = this.appState.replayDatasetId
      ? { source: this.appState.replayDatasetSource || 'github', id: this.appState.replayDatasetId }
      : null;
    const selected = current && ((current.source === 'local' && localDatasets.some((item) => item.id === current.id)) || (current.source === 'github' && datasets.some((item) => item.id === current.id)))
      ? current
      : (datasets[0] ? { source: 'github', id: datasets[0].id } : { source: 'local', id: localDatasets[0].id });

    if (this.datasetSelect) this.datasetSelect.value = selected.source + ':' + selected.id;
    await this.selectDataset(selected.source + ':' + selected.id);
  }

  async selectDataset(selection) {
    if (this.destroyed || this.mode !== 'replay' || !selection) return;
    const parsed = this._parseSelection(selection);
    const dataset = parsed.source === 'local'
      ? await this.localDatasetRepository.get(parsed.id)
      : await this.datasetRepository.get(parsed.id);
    const metadata = dataset?.metadata || dataset;
    if (!metadata) {
      this._setStatus('REPLAY · dataset not found');
      return;
    }

    await this.pauseReplay?.();
    this.appState.setReplayDatasetId(metadata.id, parsed.source);
    this.appState.symbol = metadata.symbol;
    this.appState.timeframe = metadata.timeframe;
    if (this.symbolSelect) this.symbolSelect.value = metadata.symbol;
    if (this.timeframeSelect) this.timeframeSelect.value = metadata.timeframe;
    this._syncButtons();
    this._setStatus('REPLAY · ' + (parsed.source === 'local' ? 'LOCAL · ' : 'GITHUB · ') + metadata.symbol + ' · ' + metadata.timeframe + ' · loading…');

    try {
      const loaded = await this.replayCapabilities.load({ datasetId: metadata.id, datasetSource: parsed.source, autoStart: false });
      if (loaded && !this.destroyed && this.mode === 'replay') {
        this._setStatus('REPLAY · ' + (parsed.source === 'local' ? 'LOCAL · ' : 'GITHUB · ') + metadata.symbol + ' · ' + metadata.timeframe + ' · ready');
      }
    } catch (error) {
      this._setStatus('REPLAY · ' + (error?.message || 'unable to load dataset'));
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [element, event, handler] of this._listeners.splice(0)) {
      try { element.removeEventListener(event, handler); } catch {}
    }
    globalThis.window?.removeEventListener?.('pagechange', this._pageChangeHandler);
    globalThis.window?.removeEventListener?.('delta-replay-datasets-changed', this._datasetChangedHandler);
    globalThis.window?.removeEventListener?.('delta-replay-local-datasets-changed', this._localDatasetChangedHandler);
    globalThis.window?.removeEventListener?.('select-replay-dataset', this._selectReplayDatasetHandler);
    this.liveMarket.destroy();
  }
}
