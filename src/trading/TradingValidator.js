export class TradingValidator {
  static validateQuantity(q) {
    if (q == null || !Number.isFinite(q)) return { valid: false, code: 'INVALID_QUANTITY', message: 'Quantity must be a finite number' };
    if (q <= 0) return { valid: false, code: 'INVALID_QUANTITY', message: 'Quantity must be > 0' };
    if (!isFinite(q)) return { valid: false, code: 'INVALID_QUANTITY', message: 'Invalid quantity' };
    return { valid: true };
  }

  static validateSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
      return { valid: false, code: 'INVALID_SYMBOL', message: 'Symbol required' };
    }
    return { valid: true };
  }

  static validateSide(side) {
    const allowed = ['BUY', 'SELL'];
    if (!allowed.includes(side)) return { valid: false, code: 'INVALID_SIDE', message: `Side must be BUY or SELL, got ${side}` };
    return { valid: true };
  }
}
