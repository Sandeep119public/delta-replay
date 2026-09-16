import assert from 'node:assert/strict';
import test from 'node:test';

import { Timeline } from '../src/ui/Timeline.js';

function element(initialValue = '0') {
  const listeners = new Map();
  return {
    value: initialValue,
    min: '0',
    max: '0',
    disabled: false,
    style: { setProperty() {} },
    dataset: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
  };
}

function labels() {
  return ['startLabel', 'currentLabel', 'endLabel', 'indexLabel', 'timeLabel', 'startIndexLabel']
    .reduce((acc, key) => { acc[key] = { textContent: '' }; return acc; }, {});
}

test('Timeline clamps programmatic and user cursor values to valid candle indices', () => {
  const slider = element();
  const els = labels();
  const timeline = new Timeline({ sliderEl: slider, ...els });
  timeline.setTotal(4, [
    { time: 100 }, { time: 200 }, { time: 300 }, { time: 400 },
  ]);

  timeline.setPosition(-50);
  assert.equal(timeline.getSelectedIndex(), 0);
  assert.match(els.indexLabel.textContent, /^1 \/ 4$/);

  timeline.setPosition(999);
  assert.equal(timeline.getSelectedIndex(), 3);
  assert.match(els.indexLabel.textContent, /^4 \/ 4$/);

  slider.value = '999';
  slider.dispatch('input');
  assert.equal(timeline.getSelectedIndex(), 3);

  slider.value = '-10';
  slider.dispatch('change');
  assert.equal(timeline.getSelectedIndex(), 0);
});

test('Timeline treats invalid and fractional totals as an empty or integral range', () => {
  const slider = element();
  const els = labels();
  const timeline = new Timeline({ sliderEl: slider, ...els });

  timeline.setTotal(Number.NaN, [{ time: 100 }]);
  assert.equal(timeline.getSelectedIndex(), 0);
  assert.equal(slider.disabled, true);

  timeline.setTotal(3.9, [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }]);
  assert.equal(slider.max, '2');
  assert.equal(timeline.getSelectedIndex(), 1);
  assert.match(els.indexLabel.textContent, /^2 \/ 3$/);
});

test('Timeline keeps empty state disabled even when explicitly enabled', () => {
  const slider = element();
  const els = labels();
  const timeline = new Timeline({ sliderEl: slider, ...els });
  timeline.setTotal(0);
  timeline.setEnabled(true);
  assert.equal(slider.disabled, true);
});

test('Timeline does not inject marker metadata into markup', () => {
  const slider = element();
  const els = labels();
  const timeline = new Timeline({ sliderEl: slider, ...els });
  timeline.markersEl = {
    firstChild: null,
    appendChild() { throw new Error('marker DOM unavailable'); },
    removeChild() {},
  };
  timeline.setTotal(2, [{ time: 100 }, { time: 200 }]);
  timeline.setMarkers([{ index: 1, side: '<img src=x onerror=alert(1)>' }]);
  assert.equal(timeline.getSelectedIndex(), 1);
});
