/**
 * Compatibility projection for candle views.
 *
 * Normalizes store-shaped candle sources into the narrow candle view
 * ({ getCount, get, getAll, findIndexByTime }) consumed by presentation
 * components. Trading and dataset sources are NOT adapted here: UI
 * constructors require the narrow, asserted presentation contracts and
 * reject engine-shaped objects outright.
 */

/**
 * Normalize any candle source into { getCount, get, getAll, findIndexByTime }.
 */
export function normalizeCandleSource(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('candle view requires a source');
  }
  if (
    typeof source.getCount === 'function' &&
    typeof source.get === 'function' &&
    typeof source.getAll === 'function' &&
    typeof source.findIndexByTime === 'function'
  ) {
    return source;
  }
  return Object.freeze({
    getCount: () => source.getCount?.() ?? source.getAll?.()?.length ?? 0,
    get: (index) => source.get?.(index) ?? source.getAll?.()?.[index] ?? null,
    getAll: () => source.getAll?.() ?? [],
    findIndexByTime: (t) => source.findIndexByTime?.(t) ?? -1,
  });
}
