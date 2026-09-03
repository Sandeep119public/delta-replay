import { describe, it, expect } from 'vitest';
import { BacktestRunner } from '../src/strategy/BacktestRunner.js';
import { PaperTradingEngine, EXECUTION_PROFILE, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';

const strategy = { onBar: () => [], reset: () => {} };

describe('BacktestRunner research timing boundary', () => {
  it('rejects a research-profile engine overridden to same-bar timing', () => {
    const engine = new PaperTradingEngine({
      executionProfile: EXECUTION_PROFILE.RESEARCH_BACKTEST,
      executionTiming: EXECUTION_TIMING.IMMEDIATE_CLOSE,
    });
    expect(() => new BacktestRunner({ strategy, engine })).toThrow(/NEXT_BAR_OPEN/);
  });
});
