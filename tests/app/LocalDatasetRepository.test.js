import { describe, expect, it } from 'vitest';
import { LocalDatasetRepository } from '../../src/app/LocalDatasetRepository.js';

const candles = [
  { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: 120, open: 100, high: 102, low: 99, close: 101, volume: 2 },
];

const csv = [
  'time,open,high,low,close,volume',
  '60,100,101,99,100,1',
  '120,100,102,99,101,2',
  '',
].join('\n');

function file(name = 'BTCUSDT-1m.csv', content = csv) {
  return {
    name,
    size: content.length,
    text: async () => content,
  };
}

describe('LocalDatasetRepository', () => {
  it('imports canonical CSV into browser-local storage and returns reusable metadata', async () => {
    const repository = new LocalDatasetRepository();
    const metadata = await repository.importFile(file());

    expect(metadata.symbol).toBe('BTCUSDT');
    expect(metadata.timeframe).toBe('1m');
    expect(metadata.count).toBe(2);
    expect(metadata.local).toBe(true);
    expect(metadata.status).toBe('validated');

    const record = await repository.get(metadata.id);
    expect(record.candles).toEqual(candles);

    const exported = await repository.getCsv(metadata.id);
    expect(exported.csv).toBe(csv);
  });

  it('accepts a replay-compatible downloaded filename with the content identity suffix', async () => {
    const repository = new LocalDatasetRepository();
    const first = await repository.importFile(file());
    const second = await repository.importFile(file('BTCUSDT-1m-' + first.contentId + '.csv'));
    expect(second.id).toBe(first.id);
  });

  it('rejects malformed datasets before storing them', async () => {
    const repository = new LocalDatasetRepository();
    await expect(repository.importFile(file('BTCUSDT-1m.csv', 'time,open,high,low,close,volume\n60,100,99,99,100,1\n')))
      .rejects.toThrow(/integrity|invalid/i);
  });

  it('can remove only local browser datasets', async () => {
    const repository = new LocalDatasetRepository();
    const metadata = await repository.importFile(file());
    await repository.remove(metadata.id);
    expect(await repository.get(metadata.id)).toBeNull();
  });
});
