import { describe, it, expect } from 'vitest';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';
import { ReplayEvents } from '../src/replay/ReplayEvents.js';
import { createReplayUIPort } from '../src/app/ReplayUIPort.js';

const candles = [
  { time: 1700000000, open: 100, high: 105, low: 95, close: 102, volume: 1 },
  { time: 1700000060, open: 102, high: 108, low: 101, close: 107, volume: 1 },
  { time: 1700000120, open: 107, high: 110, low: 103, close: 105, volume: 1 },
];

describe('Replay presentation boundary', () => {
  it('exposes only narrow replay capabilities', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    expect(Object.isFrozen(port)).toBe(true);
    expect(port).not.toHaveProperty('_candles');
    expect(port).not.toHaveProperty('registerActionGuard');
    engine.destroy();
  });

  it('seek is navigation-only and does not emit market execution', () => {
    const engine = new ReplayEngine();
    const port = createReplayUIPort(engine);
    const execution = [];
    const navigation = [];
    port.on(ReplayEvents.MARKET_CANDLE, ({ index }) => execution.push(index));
    port.on(ReplayEvents.SEEKED, ({ index }) => navigation.push(index));
    engine.load(candles);
    engine.start(0);
    port.seek(2);
    expect(execution).toEqual([0]);
    expect(navigation).toEqual([2]);
    engine.destroy();
  });
});
