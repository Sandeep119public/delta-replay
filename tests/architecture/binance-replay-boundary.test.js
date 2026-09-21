import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('replay composition uses stored datasets rather than Binance historical provider', async () => {
  const source = await readFile(new URL('../../src/app/createCoreServices.js', import.meta.url), 'utf8');
  assert.match(source, /StoredDatasetProvider/);
  assert.doesNotMatch(source, /BinanceCandleProvider/);
  assert.doesNotMatch(source, /DeltaCandleProvider|DeltaClient/);
});
