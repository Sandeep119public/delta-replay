from math import isfinite

from ..models import Candle


TAKER_FEE_RATE = 0.0005
SMA_PERIOD = 3
EXECUTION_MODEL = "NEXT_BAR_OPEN"


class BacktestService:
    """Deterministic backtest runner with causal next-bar-open execution."""

    def run(self, candles, strategy="buy_and_hold", quantity=1.0, fee_rate=TAKER_FEE_RATE):
        try:
            quantity = float(quantity)
            fee_rate = float(fee_rate)
        except (TypeError, ValueError) as exc:
            raise ValueError("quantity and fee_rate must be numeric") from exc
        if not isfinite(quantity) or quantity <= 0:
            raise ValueError("quantity must be finite and positive")
        if not isfinite(fee_rate) or not 0 <= fee_rate < 1:
            raise ValueError("fee_rate must be finite and in [0,1)")
        if strategy not in ("buy_and_hold", "sma_cross"):
            raise ValueError(f"unknown strategy: {strategy}")

        if not candles:
            return {
                "summary": {
                    "strategy": strategy,
                    "strategyDefinition": self._strategy_definition(strategy),
                    "executionModel": EXECUTION_MODEL,
                    "trades": 0,
                    "pnl": 0.0,
                    "fees": 0.0,
                },
                "trades": [],
            }

        try:
            candles = [Candle.model_validate(candle).model_dump() for candle in candles]
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid candle data: {exc}") from exc

        self._validate_chronology(candles)
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
                trades.append({
                    "side": "long",
                    "entry": entry,
                    "exit": exit_price,
                    "quantity": quantity,
                    "pnl": gross,
                    "fees": entry_fee + close_fee,
                    "netPnl": net,
                })
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
            trades.append({
                "side": "long",
                "entry": entry,
                "exit": exit_price,
                "quantity": quantity,
                "pnl": gross,
                "fees": entry_fee + close_fee,
                "netPnl": net,
            })
            total_gross += gross
            total_net += net
            total_fees += close_fee

        return {
            "summary": {
                "strategy": strategy,
                "strategyDefinition": self._strategy_definition(strategy),
                "executionModel": EXECUTION_MODEL,
                "trades": len(trades),
                "pnl": total_net,
                "grossPnl": total_gross,
                "fees": total_fees,
            },
            "trades": trades,
        }

    @staticmethod
    def _validate_chronology(candles):
        times = [int(candle["time"]) for candle in candles]
        if any(current <= previous for previous, current in zip(times, times[1:])):
            raise ValueError("candles must be strictly ordered by increasing time")

    @staticmethod
    def _strategy_definition(strategy):
        if strategy == "buy_and_hold":
            return "buy on the first signal and hold until the final candle"
        return f"close-price crossing a {SMA_PERIOD}-period SMA, executed on the next bar open"

    def _signals(self, candles, strategy):
        if strategy == "buy_and_hold":
            return ["buy"] + ["hold"] * (len(candles) - 1)

        if strategy == "sma_cross":
            closes = [float(c["close"]) for c in candles]
            signals = ["hold"] * len(candles)
            for i in range(SMA_PERIOD, len(closes)):
                previous_sma = sum(closes[i - SMA_PERIOD:i]) / SMA_PERIOD
                current_sma = sum(closes[i - SMA_PERIOD + 1:i + 1]) / SMA_PERIOD
                previous_price = closes[i - 1]
                current_price = closes[i]
                crossed_up = previous_price <= previous_sma and current_price > current_sma
                crossed_down = previous_price >= previous_sma and current_price < current_sma
                if crossed_up:
                    signals[i] = "buy"
                elif crossed_down:
                    signals[i] = "sell"
            return signals

        raise ValueError(f"unknown strategy: {strategy}")
