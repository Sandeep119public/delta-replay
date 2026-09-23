export function createPaperPorts(el) {
  return {
    replay: () => ({
      dataStatusEl: el('data-status'),
      cacheBadgeEl: el('cache-badge'),
      headerStartReplayBtn: el('header-start-replay-btn'),
    }),
    orderForm: () => ({
      timeframeSelect: el('timeframe-select'),
      orderTypeSelect: el('order-type'),
      limitPriceInput: el('limit-price'),
      stopPriceInput: el('stop-price'),
      slInput: el('sl-price'),
      tpInput: el('tp-price'),
    }),
  };
}
