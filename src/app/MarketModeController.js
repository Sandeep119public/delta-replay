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
    replayCapabilities,
    chartManager = null,
    pauseReplay = null,
    dataStatus = null,
  } = {}) {
    if (!page || !appState || !liveMarket || !datasetRepository || !replayCapabilities) {
      throw new TypeError('MarketModeController requires page, appState, liveMarket, datasetRepository and replayCapabilities');
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
    this._selectReplayDatasetHandler = (event) => {
      const datasetId = event?.detail?.datasetId;
      if (!datasetId) return;
      void this.setMode('replay').then(() => this.selectDataset(datasetId));
    };

    this._listen(this.liveButton, 'click', () => { void this.setMode('live'); });
    this._listen(this.replayButton, 'click', () => { void this.setMode('replay'); });
    this._listen(this.datasetRefresh, 'click', () => { void this.refreshDatasets(); });
    this._listen(this.datasetSelect, 'change', () => {
      void this.selectDataset(this.datasetSelect?.value);
    });
    globalThis.window?.addEventListener?.('pagechange', this._pageChangeHandler);
    globalThis.window?.addEventListener?.('delta-replay-datasets-changed', this._datasetChangedHandler);
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
    this._setStatus('REPLAY · selecting saved dataset…');
    await this.refreshDatasets();
  }

  async refreshDatasets() {
    if (this.destroyed || this.mode !== 'replay') return;
    const datasets = await this.datasetRepository.list();
    if (this.datasetSelect) {
      this.datasetSelect.replaceChildren();
      if (!datasets.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No saved datasets';
        this.datasetSelect.appendChild(option);
      } else {
        for (const dataset of datasets) {
          const option = document.createElement('option');
          option.value = dataset.id;
          option.textContent = `${dataset.symbol} · ${dataset.timeframe} · ${Number(dataset.count || 0).toLocaleString()} candles`;
          this.datasetSelect.appendChild(option);
        }
      }
    }

    if (!datasets.length) {
      this.chartManager?.clear?.();
      this._setStatus('REPLAY · no saved dataset · use Downloads');
      this.controls?.setEnabledForPreview(false);
      return;
    }

    const currentId = this.appState.replayDatasetId;
    const selected = datasets.find((dataset) => dataset.id === currentId) || datasets[0];
    if (this.datasetSelect) this.datasetSelect.value = selected.id;
    await this.selectDataset(selected.id);
  }

  async selectDataset(datasetId) {
    if (this.destroyed || this.mode !== 'replay' || !datasetId) return;
    const dataset = await this.datasetRepository.get(datasetId);
    if (!dataset) {
      this._setStatus('REPLAY · saved dataset not found');
      return;
    }

    await this.pauseReplay?.();
    this.appState.setReplayDatasetId(dataset.id);
    this.appState.symbol = dataset.symbol;
    this.appState.timeframe = dataset.timeframe;
    if (this.symbolSelect) this.symbolSelect.value = dataset.symbol;
    if (this.timeframeSelect) this.timeframeSelect.value = dataset.timeframe;
    this._syncButtons();
    this._setStatus(`REPLAY · ${dataset.symbol} · ${dataset.timeframe} · loading saved data…`);

    try {
      const loaded = await this.replayCapabilities.load({ datasetId: dataset.id, autoStart: false });
      if (loaded && !this.destroyed && this.mode === 'replay') {
        this._setStatus(`REPLAY · ${dataset.symbol} · ${dataset.timeframe} · ready`);
      }
    } catch (error) {
      this._setStatus('REPLAY · ' + (error?.message || 'unable to load saved dataset'));
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
    globalThis.window?.removeEventListener?.('select-replay-dataset', this._selectReplayDatasetHandler);
    this.liveMarket.destroy();
  }
}
