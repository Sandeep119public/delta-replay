import { describe, expect, it } from 'vitest';

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

describe('Timeline invariants', () => {
  it('clamps programmatic and user cursor values to valid candle indices', () => {
    const slider = element();
    const els = labels();
    const timeline = new Timeline({ sliderEl: slider, ...els });
    timeline.setTotal(4, [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }]);

    timeline.setPosition(-50);
    expect(timeline.getSelectedIndex()).toBe(0);
    expect(els.indexLabel.textContent).toMatch(/^1 \/ 4$/);

    timeline.setPosition(999);
    expect(timeline.getSelectedIndex()).toBe(3);
    expect(els.indexLabel.textContent).toMatch(/^4 \/ 4$/);

    slider.value = '999';
    slider.dispatch('input');
    expect(timeline.getSelectedIndex()).toBe(3);

    slider.value = '-10';
    slider.dispatch('change');
    expect(timeline.getSelectedIndex()).toBe(0);
  });

  it('treats invalid and fractional totals as an empty or integral range', () => {
    const slider = element();
    const els = labels();
    const timeline = new Timeline({ sliderEl: slider, ...els });

    timeline.setTotal(Number.NaN, [{ time: 100 }]);
    expect(timeline.getSelectedIndex()).toBe(0);
    expect(slider.disabled).toBe(true);

    timeline.setTotal(3.9, [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }]);
    expect(slider.max).toBe('2');
    expect(timeline.getSelectedIndex()).toBe(1);
    expect(els.indexLabel.textContent).toMatch(/^2 \/ 3$/);
  });

  it('keeps empty state disabled even when explicitly enabled', () => {
    const slider = element();
    const els = labels();
    const timeline = new Timeline({ sliderEl: slider, ...els });
    timeline.setTotal(0);
    timeline.setEnabled(true);
    expect(slider.disabled).toBe(true);
  });

  it('renders marker metadata as DOM properties rather than HTML', () => {
    const slider = element();
    const els = labels();
    const children = [];
    const markersEl = {
      firstChild: null,
      ownerDocument: {
        createElement() {
          return {
            className: '',
            style: {},
            title: '',
            setAttribute(name, value) { this[name] = value; },
          };
        },
      },
      appendChild(node) { children.push(node); },
      removeChild() {},
    };
    const timeline = new Timeline({ sliderEl: slider, ...els });
    timeline.markersEl = markersEl;
    timeline.setTotal(2, [{ time: 100 }, { time: 200 }]);
    timeline.setMarkers([{ index: 1, side: '<img src=x onerror=alert(1)>' }]);

    expect(children).toHaveLength(1);
    expect(children[0].title).toBe('<IMG SRC=X ONERROR=ALERT(1)> @ #1');
  });
});
