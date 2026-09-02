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

  static validateLimitPrice(p) {
    if (p == null || !Number.isFinite(p)) return { valid: false, code: 'INVALID_LIMIT_PRICE', message: 'Limit price must be a finite number' };
    if (p <= 0) return { valid: false, code: 'INVALID_LIMIT_PRICE', message: 'Limit price must be > 0' };
    return { valid: true };
  }

  static validateOrderType(type) {
    const allowed = ['MARKET', 'LIMIT', 'STOP_MARKET'];
    if (!allowed.includes(type)) return { valid: false, code: 'INVALID_ORDER_TYPE', message: `Order type must be MARKET or LIMIT or STOP_MARKET, got ${type}` };
    return { valid: true };
  }

  static validateStopPrice(p) {
    if (p == null || !Number.isFinite(p)) return { valid: false, code: 'INVALID_STOP_PRICE', message: 'Stop price must be a finite number' };
    if (p <= 0) return { valid: false, code: 'INVALID_STOP_PRICE', message: 'Stop price must be > 0' };
    return { valid: true };
  }
}
