import { describe, expect, it, vi } from 'vitest';
import { ReplayDateSelector } from '../src/ui/ReplayDateSelector.js';

function makeElement(initialValue = '') {
  const listeners = new Map();
  return {
    value: initialValue,
    min: '',
    max: '',
    dataset: {},
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
  };
}

function makeSelector(onLoadReplay) {
  const replayDateEl = makeElement('2026-09-10');
  const replayTimeEl = makeElement('12:00');
  const jumpDateEl = makeElement('2026-09-10');
  const jumpTimeEl = makeElement('12:00');
  const replayPort = { getState: () => ({ status: 'ready' }) };
  const dataset = { symbol: 'BTCUSDT', timeframe: '15m' };
  const chip = makeElement();
  chip.dataset.preset = '1d';
  return {
    selector: new ReplayDateSelector({
      dataset,
      candles: { getCount: () => 0 },
      replay: replayPort,
      onLoadReplay,
      replayDateEl,
      replayTimeEl,
      jumpDateEl,
      jumpTimeEl,
      presetChips: [chip],
    }),
    replayDateEl,
  };
}

describe('ReplayDateSelector', () => {
  it('cancels a pending manual date load when a preset is selected', () => {
    vi.useFakeTimers();
    const loads = [];
    const { selector, replayDateEl } = makeSelector((payload) => loads.push(payload));

    replayDateEl.value = '2026-09-01';
    replayDateEl.dispatch('change');
    selector.selectPreset('1d');
    vi.advanceTimersByTime(400);

    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ autoStart: false });
    selector.destroy();
    vi.useRealTimers();
  });

  it('cancels an older debounced load before scheduling a newer input change', () => {
    vi.useFakeTimers();
    const loads = [];
    const { selector, replayDateEl } = makeSelector((payload) => loads.push(payload));

    replayDateEl.value = '2026-09-01';
    replayDateEl.dispatch('change');
    vi.advanceTimersByTime(200);
    replayDateEl.value = '2026-09-02';
    replayDateEl.dispatch('change');
    vi.advanceTimersByTime(200);

    expect(loads).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(loads).toHaveLength(1);

    selector.destroy();
    vi.useRealTimers();
  });
});
