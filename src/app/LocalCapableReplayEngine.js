import { RemoteReplayEngine } from './RemoteReplayEngine.js';

const LOCAL_CHUNK_SIZE = 50_000;

export class LocalCapableReplayEngine extends RemoteReplayEngine {
  async loadLocalDataset(candles) {
    if (this._destroyed) return this.getState();
    if (!Array.isArray(candles) || candles.length === 0) throw new TypeError('Local replay dataset must contain candles');

    this.pause();
    const generation = this._invalidateGeneration();
    let state = this.getState();

    for (let start = 0; start < candles.length; start += LOCAL_CHUNK_SIZE) {
      if (this._destroyed || generation !== this._generation) return this.getState();
      const chunk = candles.slice(start, start + LOCAL_CHUNK_SIZE);
      const reset = start === 0;
      state = await this._call(
        '/load-chunk?reset=' + String(reset),
        { method: 'POST', body: JSON.stringify({ candles: chunk }) },
        generation,
        'load',
      );
    }

    return state;
  }
}
