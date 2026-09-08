from ..models import Candle


TAKER_FEE_RATE = 0.0005


class BacktestService:
    """Small deterministic strategy runner with next-bar-open execution."""

    def run(self, candles, strategy="buy_and_hold", quantity=1.0, fee_rate=TAKER_FEE_RATE):
        if not candles:
            return {"summary": {"strategy": strategy, "trades": 0, "pnl": 0.0, "fees": 0.0}, "trades": []}
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if not 0 <= fee_rate <= 1:
            raise ValueError("fee_rate must be in [0,1]")

        try:
            candles = [Candle.model_validate(candle).model_dump() for candle in candles]
        except ValueError as exc:
            raise ValueError(f"invalid candle data: {exc}") from exc

        signals = self._signals(candles, strategy)
        trades = []
        total_net = 0.0
        total_gross = 0.0
        total_fees = 0.0
        entry = None
        entry_fee = 0.0
        for i, signal in enumerate(signals):
            if signal == "buy" and entry is None and i + 1 < len(candles):
                entry = float(candles[i + 1]["open"])
                entry_fee = abs(entry * quantity) * fee_rate
                total_fees += entry_fee
            elif signal == "sell" and entry is not None:
                exit_price = float(candles[i + 1]["open"]) if i + 1 < len(candles) else float(candles[i]["close"])
                close_fee = abs(exit_price * quantity) * fee_rate
                gross = (exit_price - entry) * quantity
                net = gross - entry_fee - close_fee
                trades.append({"side": "long", "entry": entry, "exit": exit_price, "quantity": quantity, "pnl": gross, "fees": entry_fee + close_fee, "netPnl": net})
                total_gross += gross
                total_net += net
                total_fees += close_fee
                entry = None
                entry_fee = 0.0
        if entry is not None:
            exit_price = float(candles[-1]["close"])
            close_fee = abs(exit_price * quantity) * fee_rate
            gross = (exit_price - entry) * quantity
            net = gross - entry_fee - close_fee
            trades.append({"side": "long", "entry": entry, "exit": exit_price, "quantity": quantity, "pnl": gross, "fees": entry_fee + close_fee, "netPnl": net})
            total_gross += gross
            total_net += net
            total_fees += close_fee
        return {"summary": {"strategy": strategy, "trades": len(trades), "pnl": total_net, "grossPnl": total_gross, "fees": total_fees}, "trades": trades}

    def _signals(self, candles, strategy):
        if strategy == "buy_and_hold":
            return ["buy"] + ["hold"] * (len(candles) - 1)
        if strategy == "sma_cross":
            period = 3
            closes = [float(c["close"]) for c in candles]
            signals = ["hold"] * len(candles)
            for i in range(period, len(closes)):
                prev = sum(closes[i-period:i]) / period
                now = sum(closes[i-period+1:i+1]) / period
                signals[i] = "buy" if now > prev else ("sell" if now < prev else "hold")
            return signals
        raise ValueError(f"unknown strategy: {strategy}")
