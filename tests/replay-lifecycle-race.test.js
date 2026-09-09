import { describe, expect, it } from 'vitest';
import { RemoteReplayEngine } from '../src/app/RemoteReplayEngine.js';

const candle = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 1 };

describe('remote replay lifecycle races', () => {
  it('does not resume play after a newer seek wins during startup', async () => {
    let resolveStart;
    const pendingStart = new Promise((resolve) => { resolveStart = resolve; });
    const api = {
      request: async (path) => {
        if (path === '/load') return { status: 'ready', index: -1, startIndex: -1, total: 3, speed: 1, visibleCandles: [] };
        if (path === '/start/0') return pendingStart;
        if (path === '/seek/2') return { status: 'paused', index: 2, startIndex: 0, total: 3, speed: 1, candle: { ...candle, time: 3 }, visibleCandles: [candle] };
        throw new Error(`unexpected request: ${path}`);
      },
    };

    const engine = new RemoteReplayEngine(api);
    await engine.load([candle, candle, candle]);

    const playing = engine.play();
    const seek = engine.seek(2);
    await seek;
    resolveStart({ status: 'paused', index: 0, startIndex: 0, total: 3, speed: 1, candle, visibleCandles: [candle] });
    await playing;

    expect(engine.getState().currentIndex).toBe(2);
    expect(engine.getState().status).toBe('paused');
  });
});
