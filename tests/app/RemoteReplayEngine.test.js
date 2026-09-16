import { describe, expect, it, vi } from 'vitest';
import { RemoteReplayEngine } from '../../src/app/RemoteReplayEngine.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('RemoteReplayEngine', () => {
  it('serializes replay mutations so seek cannot overtake an in-flight step', async () => {
    const step = deferred();
    const requests = [];
    const api = {
      request: vi.fn((path) => {
        requests.push(path);
        if (path.startsWith('/step')) return step.promise;
        return Promise.resolve({ status: 'paused', index: 0, startIndex: 0, total: 3, candle: null, visibleCandles: [] });
      }),
    };
    const engine = new RemoteReplayEngine(api, null, () => 'BTCUSDT');
    engine.state = { status: 'paused', currentIndex: 0, startIndex: 0, totalCandles: 3, speed: 1, candle: null, visibleCandles: [] };

    const stepRequest = engine.stepForward();
    const seekRequest = engine.seek(2);

    await Promise.resolve();
    expect(requests).toEqual(['/step?symbol=BTCUSDT']);

    step.resolve({ status: 'paused', index: 1, startIndex: 0, total: 3, candle: null, visibleCandles: [] });
    await stepRequest;
    await Promise.resolve();

    expect(requests).toEqual(['/step?symbol=BTCUSDT', '/seek/2?symbol=BTCUSDT']);

    await seekRequest;
    expect(engine.getState().currentIndex).toBe(2);
  });

  it('serializes reset behind an in-flight start and publishes only the newest generation', async () => {
    const start = deferred();
    const requests = [];
    const api = {
      request: vi.fn((path) => {
        requests.push(path);
        if (path.startsWith('/start/')) return start.promise;
        return Promise.resolve({ status: 'ready', index: -1, startIndex: -1, total: 3, candle: null, visibleCandles: [] });
      }),
    };
    const engine = new RemoteReplayEngine(api, null, () => 'ETHUSDT');
    engine.state = { status: 'ready', currentIndex: -1, startIndex: 0, totalCandles: 3, speed: 1, candle: null, visibleCandles: [] };
    const stateEvents = vi.fn();
    engine.on('stateChanged', stateEvents);

    const startRequest = engine.start(0);
    const resetRequest = engine.reset();

    await Promise.resolve();
    expect(requests).toEqual(['/start/0?symbol=ETHUSDT']);

    start.resolve({ status: 'paused', index: 0, startIndex: 0, total: 3, candle: null, visibleCandles: [] });
    await startRequest;
    await Promise.resolve();

    expect(requests).toEqual(['/start/0?symbol=ETHUSDT', '/reset']);

    await resetRequest;
    expect(engine.getState().currentIndex).toBe(-1);
    expect(stateEvents).toHaveBeenCalledTimes(1);
  });
});
