/**
 * Presentation boundary contract for trading integrations.
 * This module is deliberately domain-agnostic: adapters supply the concrete
 * event names and operations, while UI code depends only on this shape.
 */
export const TRADING_PRESENTATION_PORT = Object.freeze({
  snapshot: Object.freeze({}),
  actions: Object.freeze({}),
  events: Object.freeze({}),
});
