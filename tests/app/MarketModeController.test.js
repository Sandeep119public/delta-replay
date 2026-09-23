import { describe, expect, it, vi } from 'vitest';
import { MarketModeController } from '../../src/app/MarketModeController.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.classes = new Set();
    this.attributes = new Map();
    this.disabled = false;
    this.children = [];
    this.value = '';
  }
  get classList() {
    return {
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
  }
  get options() { return this.children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children.flat(); }
}

function deps() {
  const page = new FakeElement();
  page.ownerDocument = { createElement: () => new FakeElement() };
  const datasetSelect = new FakeElement();
  const liveButton = new FakeElement();
  const replayButton = new FakeElement();
  const datasetRefresh = new FakeElement();
  const symbolSelect = new FakeElement();
  const timeframeSelect = new FakeElement();
  const appState = {
    mode: 'live',
    symbol: 'BTCUSDT',
    timeframe: '1m',
    replayDatasetId: null,
    replayDatasetSource: null,
    setMode: vi.fn((mode) => { appState.mode = mode; }),
    setReplayDatasetId: vi.fn((id, source) => { appState.replayDatasetId = id; appState.replayDatasetSource = source; }),
  };
  const liveMarket = { start: vi.fn(async () => undefined), stop: vi.fn(), destroy: vi.fn() };
  const datasetRepository = {
    list: vi.fn(async () => [{ id: 'btc-1m', symbol: 'BTCUSDT', timeframe: '1m', count: 100 }]),
    get: vi.fn(async (id) => id ? { id, symbol: 'BTCUSDT', timeframe: '1m', count: 100 } : null),
  };
  const localDatasetRepository = {
    list: vi.fn(async () => [{ id: 'local-btc-1m', symbol: 'BTCUSDT', timeframe: '1m', count: 90 }]),
    get: vi.fn(async (id) => id ? { id, metadata: { id, symbol: 'BTCUSDT', timeframe: '1m', count: 90 } } : null),
  };
  const replayCapabilities = { load: vi.fn(async () => ({ symbol: 'BTCUSDT', timeframe: '1m' })) };
  const controls = { setEnabledForPreview: vi.fn() };
  return { page, datasetSelect, liveButton, replayButton, datasetRefresh, symbolSelect, timeframeSelect, appState, liveMarket, datasetRepository, localDatasetRepository, replayCapabilities, controls };
}

describe('MarketModeController', () => {
  it('keeps live market and replay as separate modes', async () => {
    const d = deps();
    const controller = new MarketModeController(d);
    await controller.setMode('live', { force: true });
    expect(d.liveMarket.start).toHaveBeenCalledWith({ symbol: 'BTCUSDT', timeframe: '1m' });
    expect(d.replayCapabilities.load).not.toHaveBeenCalled();
    await controller.setMode('replay');
    expect(d.liveMarket.stop).toHaveBeenCalled();
    expect(d.replayCapabilities.load).toHaveBeenCalled();
  });

  it('loads the selected saved dataset directly through replay loading', async () => {
    const d = deps();
    const controller = new MarketModeController(d);
    await controller.setMode('replay');
    d.replayCapabilities.load.mockClear();
    d.liveMarket.start.mockClear();

    await controller.selectDataset('github:btc-1m');

    expect(d.datasetRepository.get).not.toHaveBeenCalled();
    expect(d.replayCapabilities.load).toHaveBeenCalledWith({ datasetId: 'btc-1m', datasetSource: 'github', autoStart: false });
    expect(d.liveMarket.start).not.toHaveBeenCalled();
    expect(d.symbolSelect.value).toBe('BTCUSDT');
    expect(d.timeframeSelect.value).toBe('1m');
  });

  it('loads a browser-local dataset directly through replay loading', async () => {
    const d = deps();
    const controller = new MarketModeController(d);
    await controller.setMode('replay');
    d.replayCapabilities.load.mockClear();

    await controller.selectDataset('local:local-btc-1m');

    expect(d.localDatasetRepository.get).not.toHaveBeenCalled();
    expect(d.replayCapabilities.load).toHaveBeenCalledWith({ datasetId: 'local-btc-1m', datasetSource: 'local', autoStart: false });
    expect(d.symbolSelect.value).toBe('BTCUSDT');
  });
});
