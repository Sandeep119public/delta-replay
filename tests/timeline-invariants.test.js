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

function timelineFixture() {
  const slider = element();
  const startLabel = { textContent: '' };
  const currentLabel = { textContent: '' };
  const endLabel = { textContent: '' };
  const indexLabel = { textContent: '' };
  const timeLabel = { textContent: '' };
  const startIndexLabel = { textContent: '' };
  const timeline = new Timeline({
    sliderEl: slider,
    startLabelEl: startLabel,
    currentLabelEl: currentLabel,
    endLabelEl: endLabel,
    indexLabelEl: indexLabel,
    timeLabelEl: timeLabel,
    startIndexLabelEl: startIndexLabel,
  });
  return { timeline, slider, indexLabel };
}

describe('Timeline invariants', () => {
  it('clamps programmatic and user cursor values to valid candle indices', () => {
    const { timeline, slider, indexLabel } = timelineFixture();
    timeline.setTotal(4, [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }]);

    timeline.setPosition(-50);
    expect(timeline.getSelectedIndex()).toBe(0);
    expect(indexLabel.textContent).toMatch(/^1 \/ 4$/);

    timeline.setPosition(999);
    expect(timeline.getSelectedIndex()).toBe(3);
    expect(indexLabel.textContent).toMatch(/^4 \/ 4$/);

    slider.value = '999';
    slider.dispatch('input');
    expect(timeline.getSelectedIndex()).toBe(3);

    slider.value = '-10';
    slider.dispatch('change');
    expect(timeline.getSelectedIndex()).toBe(0);
  });

  it('treats invalid and fractional totals as an empty or integral range', () => {
    const { timeline, slider, indexLabel } = timelineFixture();

    timeline.setTotal(Number.NaN, [{ time: 100 }]);
    expect(timeline.getSelectedIndex()).toBe(0);
    expect(slider.disabled).toBe(true);

    timeline.setTotal(3.9, [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }]);
    expect(slider.max).toBe('2');
    expect(timeline.getSelectedIndex()).toBe(1);
    expect(indexLabel.textContent).toMatch(/^2 \/ 3$/);
  });

  it('keeps empty state disabled even when explicitly enabled', () => {
    const { timeline, slider } = timelineFixture();
    timeline.setTotal(0);
    timeline.setEnabled(true);
    expect(slider.disabled).toBe(true);
  });

  it('renders marker metadata as DOM properties rather than HTML', () => {
    const { timeline } = timelineFixture();
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
    timeline.markersEl = markersEl;
    timeline.setTotal(2, [{ time: 100 }, { time: 200 }]);
    timeline.setMarkers([{ index: 1, side: '<img src=x onerror=alert(1)>' }]);

    expect(children).toHaveLength(1);
    expect(children[0].title).toBe('<IMG SRC=X ONERROR=ALERT(1)> @ #1');
  });
});
