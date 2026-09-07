export function createPaperPorts(el) {
  return {
    replay: () => ({
      dataStatusEl: el('data-status'), cacheBadgeEl: el('cache-badge'),
      startReplayBtn: el('start-replay-btn'), headerStartReplayBtn: el('header-start-replay-btn'),
      loadBtn: el('load-btn'), fromDateEl: el('from-date'), fromTimeEl: el('from-time'),
      toDateEl: el('to-date'), toTimeEl: el('to-time'),
    }),
    orderForm: () => ({
      timeframeSelect: el('timeframe-select'), orderTypeSelect: el('order-type'),
      limitPriceInput: el('limit-price'), stopPriceInput: el('stop-price'),
      slInput: el('sl-price'), tpInput: el('tp-price'),
    }),
  };
}
