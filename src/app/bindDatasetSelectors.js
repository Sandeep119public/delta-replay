export function bindDatasetSelectors(ui, actions) {
  if (!ui || !actions?.changeDataset) throw new TypeError('bindDatasetSelectors requires UI and application actions');

  const unbinds = [
    ui.symbolSelector.onChange((symbol) => actions.changeDataset('symbol', symbol, ui.el('symbol-select'))),
    ui.timeframeSelector.onChange((timeframe) => actions.changeDataset('timeframe', timeframe, ui.el('timeframe-select'))),
  ];
  let destroyed = false;

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unbinds.forEach((unbind) => {
        try { unbind?.(); } catch {}
      });
    },
  });
}
