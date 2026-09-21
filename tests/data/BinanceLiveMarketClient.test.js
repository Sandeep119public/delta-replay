import { describe, expect, it, vi } from 'vitest';
import { BinanceLiveMarketClient } from '../../src/data/BinanceLiveMarketClient.js';

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  emitOpen() { this.onopen?.(); }
  emitMessage(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

describe('BinanceLiveMarketClient', () => {
  it('connects to the current Binance futures market kline stream', () => {
    const client = new BinanceLiveMarketClient({ WebSocketCtor: FakeSocket });
    const onCandle = vi.fn();

    client.connect({ symbol: 'BTCUSDT', timeframe: '1m', onCandle });

    expect(FakeSocket.instances.at(-1).url).toBe(
      'wss://fstream.binance.com/market/ws/btcusdt@kline_1m',
    );

    FakeSocket.instances.at(-1).emitMessage({
      e: 'kline',
      k: { t: 1000000, o: '10', h: '12', l: '9', c: '11', v: '100' },
    });

    expect(onCandle).toHaveBeenCalledWith({
      time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100,
    });

    client.stop();
  });
});
