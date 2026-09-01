import { describe, it, expect } from 'vitest';
import { CandleValidator } from '../src/data/CandleValidator.js';

const good = { time: 1700000000, open: 100, high: 110, low: 90, close: 105, volume: 10 };

describe('CandleValidator', () => {
  it('accepts valid candle', () => {
    expect(CandleValidator.validate(good).valid).toBe(true);
  });

  it('rejects duplicate timestamps (strictly increasing)', () => {
    // prevTime 1700000000, current same => invalid
    expect(CandleValidator.validate({ ...good, time: 1700000000 }, 1700000000).valid).toBe(false);
  });

  it('rejects unsorted (decreasing) timestamps', () => {
    expect(CandleValidator.validate({ ...good, time: 1699999999 }, 1700000000).valid).toBe(false);
  });

  it('rejects invalid OHLC high < open', () => {
    expect(CandleValidator.validate({ ...good, high: 50 }).valid).toBe(false);
  });

  it('rejects high < close', () => {
    expect(CandleValidator.validate({ ...good, high: 100 }).valid).toBe(false); // high 100 < close 105
  });

  it('rejects low > open', () => {
    expect(CandleValidator.validate({ ...good, low: 200 }).valid).toBe(false);
  });

  it('rejects negative price', () => {
    expect(CandleValidator.validate({ ...good, open: -5 }).valid).toBe(false);
  });

  it('rejects invalid volume negative', () => {
    expect(CandleValidator.validate({ ...good, volume: -1 }).valid).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(CandleValidator.validate({ ...good, open: NaN }).valid).toBe(false);
    expect(CandleValidator.validate({ ...good, close: Infinity }).valid).toBe(false);
  });

  it('allows zero volume', () => {
    expect(CandleValidator.validate({ ...good, volume: 0 }).valid).toBe(true);
  });

  it('validateBatch collects errors', () => {
    const batch = [
      good,
      { ...good, time: good.time + 60, high: 1 }, // invalid
      { ...good, time: good.time + 120 }
    ];
    const { validCandles, errors } = CandleValidator.validateBatch(batch);
    expect(validCandles.length).toBe(2);
    expect(errors.length).toBe(1);
    expect(errors[0].index).toBe(1);
  });
});
