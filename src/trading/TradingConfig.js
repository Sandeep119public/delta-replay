import { FeeCalculator } from './FeeCalculator.js';

export const TRADING_CONFIG = {
  TAKER_FEE_RATE: 0.0005, // 0.05%
};

export function calcFee(notional, rate = TRADING_CONFIG.TAKER_FEE_RATE) {
  return FeeCalculator.calculate(notional, rate);
}
