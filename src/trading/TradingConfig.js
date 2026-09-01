export const TRADING_CONFIG = {
  TAKER_FEE_RATE: 0.0005, // 0.05%
};

export function calcFee(notional, rate = TRADING_CONFIG.TAKER_FEE_RATE) {
  const n = Number(notional);
  const r = Number(rate);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n <= 0 || r < 0) return 0;
  return n * r;
}
