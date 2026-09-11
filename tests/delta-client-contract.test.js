import { describe, it, expect } from 'vitest';
import { DeltaClient } from '../src/data/DeltaClient.js';

describe('DeltaClient input contract', () => {
  it('rejects unsupported resolutions before issuing a request', async () => {
    let calls = 0;
    const client = new DeltaClient({
      fetchFn: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ success: true, result: [] }) };
      },
    });

    await expect(client.fetchCandles({
      symbol: 'BTCUSD',
      resolution: '17m',
      start: 1000,
      end: 1060,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls).toBe(0);
  });
});
