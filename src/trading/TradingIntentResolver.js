/**
 * TradingIntentResolver determines trading intent (Take-Profit, Stop-Loss, or Price Selection)
 * for a selected price based on the active position context.
 *
 * Extracted from presentation overlays to maintain pure Separation of Concerns.
 */
export class TradingIntentResolver {
  /**
   * Determine intent for a clicked chart price based on active position context.
   *
   * @param {number} price - The clicked or selected price
   * @param {object|null} activePosition - The active position object if any
   * @returns {{ action: 'SET_TP'|'SET_SL'|'PRICE_SELECT', price: number, isTP?: boolean, symbol?: string } | null}
   */
  static resolveClickIntent(price, activePosition = null) {
    if (!Number.isFinite(price) || price <= 0) return null;

    if (activePosition && Number.isFinite(Number(activePosition.entryPrice))) {
      const isLong = activePosition.side === 'LONG';
      const entryPrice = Number(activePosition.entryPrice);
      const isTP = isLong ? (price > entryPrice) : (price < entryPrice);

      return {
        action: isTP ? 'SET_TP' : 'SET_SL',
        price,
        isTP,
        symbol: activePosition.symbol,
      };
    }

    return {
      action: 'PRICE_SELECT',
      price,
    };
  }
}
