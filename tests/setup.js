import { PaperTradingEngine, EXECUTION_TIMING } from '../src/trading/PaperTradingEngine.js';

// Set legacy test default for interactive UI manual test suites
PaperTradingEngine.defaultExecutionTiming = EXECUTION_TIMING.IMMEDIATE_CLOSE;
