import { describe, expect, it, vi } from 'vitest';
import { bindDatasetSelectors } from '../../src/app/bindDatasetSelectors.js';

describe('bindDatasetSelectors', () => {
  it('routes symbol and timeframe changes and tears both down', () => {
    const handlers = {};
    const unbindSymbol = vi.fn();
    const unbindTimeframe = vi.fn();
    const changeDataset = vi.fn();
    const ui = {
      symbolSelector: { onChange: vi.fn((handler) => { handlers.symbol = handler; return unbindSymbol; }) },
      timeframeSelector: { onChange: vi.fn((handler) => { handlers.timeframe = handler; return unbindTimeframe; }) },
      el: vi.fn((id) => id),
    };

    const binding = bindDatasetSelectors(ui, { changeDataset });

    handlers.symbol('BTCUSDT');
    handlers.timeframe('15m');
    binding.destroy();
    binding.destroy();

    expect(changeDataset).toHaveBeenNthCalledWith(1, 'symbol', 'BTCUSDT', 'symbol-select');
    expect(changeDataset).toHaveBeenNthCalledWith(2, 'timeframe', '15m', 'timeframe-select');
    expect(unbindSymbol).toHaveBeenCalledOnce();
    expect(unbindTimeframe).toHaveBeenCalledOnce();
  });
});
