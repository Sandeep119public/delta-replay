import { describe, it, expect } from 'vitest';
import { TradingValidator } from '../src/trading/TradingValidator.js';

describe('TradingValidator symbol hardening', () => {
  it('accepts common exchange symbol formats', () => {
    for (const symbol of ['BTCUSDT', 'BTC-USD', 'BTC/USD', 'BTC.USDT', 'BINANCE:BTCUSDT']) {
      expect(TradingValidator.validateSymbol(symbol)).toEqual({ valid: true });
    }
  });

  it('rejects blank, non-string, control, and markup-like symbols', () => {
    for (const symbol of ['', '   ', null, 123, 'BTC USDT', 'BTC<USD>', 'BTC\nUSD', 'BTC\tUSD']) {
      const result = TradingValidator.validateSymbol(symbol);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_SYMBOL');
    }
  });

  it('rejects symbols longer than the domain limit', () => {
    const result = TradingValidator.validateSymbol('A'.repeat(33));
    expect(result.valid).toBe(false);
    expect(result.code).toBe('INVALID_SYMBOL');
  });

  it('keeps surrounding whitespace normalization deterministic', () => {
    expect(TradingValidator.validateSymbol(' BTCUSDT ')).toEqual({ valid: true });
  });
});
