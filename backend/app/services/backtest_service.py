from math import isfinite

from ..domain.execution import EXECUTION_MODEL
from ..models import Candle
from .paper_engine import PaperTradingEngine


TAKER_FEE_RATE = 0.0005
SMA_PERIOD = 3
_BACKTEST_STARTING_BALANCE = 1_000_000_000_000.0


class BacktestService:
    """Deterministic backtest runner using the canonical trading ledger and execution rules."""

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
        engine = PaperTradingEngine(
            starting_balance=_BACKTEST_STARTING_BALANCE,
            fee_rate=fee_rate,
            margin_rate=1.0,
            maint_margin_rate=0.0,
        )
        pending_exit = False

        for i, signal in enumerate(signals):
            candle = candles[i]
            if pending_exit and engine.has_open_position("BACKTEST"):
                engine.close("BACKTEST", float(candle["open"]), reason="SIGNAL", timestamp=candle.get("time"))
                pending_exit = False

            engine.on_candle(candle, i, "BACKTEST")

            if signal == "buy" and not engine.has_open_position("BACKTEST") and not engine.pending_orders():
                engine.submit("BACKTEST", "buy", quantity, "market")
            elif signal == "sell" and engine.has_open_position("BACKTEST"):
                pending_exit = True

        if engine.has_open_position("BACKTEST"):
            final = candles[-1]
            engine.close("BACKTEST", float(final["close"]), reason="BACKTEST_END", timestamp=final.get("time"))

        trades = [
            {
                "side": trade["side"].lower(),
                "entry": trade["entryPrice"],
                "exit": trade["exitPrice"],
                "quantity": trade["quantity"],
                "pnl": trade["grossPnL"],
                "fees": trade["totalFee"],
                "netPnl": trade["netPnL"],
            }
            for trade in engine.trades
        ]
        total_gross = sum(trade["grossPnL"] for trade in engine.trades)
        total_net = sum(trade["netPnL"] for trade in engine.trades)
        total_fees = sum(trade["totalFee"] for trade in engine.trades)
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
