/**
 * InstrumentConfig — Formalized instrument and symbol identity.
 *
 * Avoids implicit/hidden string remapping by defining canonical instruments,
 * display symbols, venue symbols, and contract specifications.
 */

export const VENUES = Object.freeze({
  BINANCE_FUTURES: 'BINANCE_FUTURES',
  BINANCE_SPOT: 'BINANCE_SPOT',
  DELTA_EXCHANGE: 'DELTA_EXCHANGE',
  LOCAL: 'LOCAL',
});

export const INSTRUMENTS = Object.freeze({
  'BTCUSD': {
    displaySymbol: 'BTCUSD',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    venues: {
      [VENUES.BINANCE_FUTURES]: { symbol: 'BTCUSDT', contractType: 'PERPETUAL' },
      [VENUES.BINANCE_SPOT]: { symbol: 'BTCUSDT', contractType: 'SPOT' },
      [VENUES.DELTA_EXCHANGE]: { symbol: 'BTCUSD', contractType: 'PERPETUAL' },
      [VENUES.LOCAL]: { symbol: 'BTCUSD', contractType: 'LOCAL' },
    },
  },
  'ETHUSD': {
    displaySymbol: 'ETHUSD',
    baseAsset: 'ETH',
    quoteAsset: 'USD',
    venues: {
      [VENUES.BINANCE_FUTURES]: { symbol: 'ETHUSDT', contractType: 'PERPETUAL' },
      [VENUES.BINANCE_SPOT]: { symbol: 'ETHUSDT', contractType: 'SPOT' },
      [VENUES.DELTA_EXCHANGE]: { symbol: 'ETHUSD', contractType: 'PERPETUAL' },
      [VENUES.LOCAL]: { symbol: 'ETHUSD', contractType: 'LOCAL' },
    },
  },
  'SOLUSD': {
    displaySymbol: 'SOLUSD',
    baseAsset: 'SOL',
    quoteAsset: 'USD',
    venues: {
      [VENUES.BINANCE_FUTURES]: { symbol: 'SOLUSDT', contractType: 'PERPETUAL' },
      [VENUES.BINANCE_SPOT]: { symbol: 'SOLUSDT', contractType: 'SPOT' },
      [VENUES.DELTA_EXCHANGE]: { symbol: 'SOLUSD', contractType: 'PERPETUAL' },
      [VENUES.LOCAL]: { symbol: 'SOLUSD', contractType: 'LOCAL' },
    },
  },
  'XRPUSD': {
    displaySymbol: 'XRPUSD',
    baseAsset: 'XRP',
    quoteAsset: 'USD',
    venues: {
      [VENUES.BINANCE_FUTURES]: { symbol: 'XRPUSDT', contractType: 'PERPETUAL' },
      [VENUES.BINANCE_SPOT]: { symbol: 'XRPUSDT', contractType: 'SPOT' },
      [VENUES.DELTA_EXCHANGE]: { symbol: 'XRPUSD', contractType: 'PERPETUAL' },
      [VENUES.LOCAL]: { symbol: 'XRPUSD', contractType: 'LOCAL' },
    },
  },
  'DOGEUSD': {
    displaySymbol: 'DOGEUSD',
    baseAsset: 'DOGE',
    quoteAsset: 'USD',
    venues: {
      [VENUES.BINANCE_FUTURES]: { symbol: 'DOGEUSDT', contractType: 'PERPETUAL' },
      [VENUES.BINANCE_SPOT]: { symbol: 'DOGEUSDT', contractType: 'SPOT' },
      [VENUES.DELTA_EXCHANGE]: { symbol: 'DOGEUSD', contractType: 'PERPETUAL' },
      [VENUES.LOCAL]: { symbol: 'DOGEUSD', contractType: 'LOCAL' },
    },
  },
});

/**
 * Resolve provider-specific symbol for a display symbol and venue.
 * @param {string} symbol - e.g. 'BTCUSD' or 'BTCUSDT'
 * @param {string} [venue=VENUES.BINANCE_FUTURES]
 * @returns {string}
 */
export function resolveVenueSymbol(symbol, venue = VENUES.BINANCE_FUTURES) {
  if (!symbol || typeof symbol !== 'string') return symbol;
  const clean = symbol.trim().toUpperCase();
  const inst = INSTRUMENTS[clean];
  if (inst && inst.venues && inst.venues[venue]?.symbol) {
    return inst.venues[venue].symbol;
  }
  // If no explicit venue mapping found, pass through clean symbol
  return clean;
}

/**
 * Get instrument metadata descriptor.
 * @param {string} symbol
 * @returns {object|null}
 */
export function getInstrumentMetadata(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const clean = symbol.trim().toUpperCase();
  return INSTRUMENTS[clean] ?? { displaySymbol: clean, venues: {} };
}
