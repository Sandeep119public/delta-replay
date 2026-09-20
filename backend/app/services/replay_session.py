from copy import deepcopy
from dataclasses import dataclass, field

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .replay_timeline import ReplayDivergenceError, ReplayTimeline, rebuild_trading


@dataclass
class ReplaySession:
    """Single owner of replay, trading, and deterministic session history."""

    replay: ReplayService = field(default_factory=ReplayService)
    trading: PaperTradingEngine = field(default_factory=PaperTradingEngine)
    _timeline: ReplayTimeline = field(default_factory=ReplayTimeline, repr=False)

    @property
    def history(self) -> list[dict]:
        return self._timeline.snapshot()

    @property
    def timeline(self) -> ReplayTimeline:
        return self._timeline

    def replace_history(self, events) -> None:
        self._timeline.replace(events)

    def record(self, command_type: str, replay_index: int, payload: dict) -> None:
        self._timeline.record(command_type, replay_index, payload)

    def truncate_future_history(self, replay_index: int) -> None:
        self._timeline.truncate_after(replay_index)

    def replace_trading(self, trading: PaperTradingEngine) -> None:
        if not isinstance(trading, PaperTradingEngine):
            raise TypeError("trading must be a PaperTradingEngine")
        self.trading = trading

    def _new_trading(self) -> PaperTradingEngine:
        return PaperTradingEngine(
            starting_balance=self.trading.account.starting_balance,
            fee_rate=self.trading.fee_rate,
            margin_rate=self.trading.margin_rate,
            maint_margin_rate=self.trading.maint_margin_rate,
        )

    def load(self, candles) -> dict:
        """Load a new immutable replay dataset and reset simulation state."""
        self.replay.load(candles)
        self.replace_trading(self._new_trading())
        self.replace_history([])
        return self.replay.state()

    def start(self, index: int, symbol: str) -> dict:
        """Start the replay and record its first market context."""
        if self.trading.has_open_position() or self.trading.pending_orders() or self.trading.trades or self.trading.orders or self.trading.funding:
            raise ValueError("Reset the simulation before starting replay after trading activity")
        result = self.replay.start(index)
        if result["index"] >= 0:
            self.trading.on_candle(result["candle"], result["index"], symbol)
            self.record("market_step", result["index"], {"symbol": symbol})
        return result

    def step(self, symbol: str) -> tuple[dict, list]:
        """Advance one market bar and atomically record the market event."""
        previous_index = self.replay.index
        result = self.replay.step()
        if result["index"] == previous_index or result["index"] < 0:
            return result, []
        events = self.trading.on_candle(result["candle"], result["index"], symbol)
        self.record("market_step", result["index"], {"symbol": symbol})
        return result, events

    def seek(self, index: int, symbol: str) -> dict:
        """Seek and deterministically reconstruct trading state at that bar."""
        result = self.replay.seek(index)
        filtered_history = [event for event in self.history if event.get("replayIndex", -1) <= result["index"]]
        current = self.trading
        self.replace_trading(rebuild_trading(
            self.replay,
            filtered_history,
            result["index"],
            default_symbol=symbol,
            starting_balance=current.account.starting_balance,
            fee_rate=current.fee_rate,
            margin_rate=current.margin_rate,
            maint_margin_rate=current.maint_margin_rate,
        ))
        self.replace_history(filtered_history)
        return result

    def reset_replay(self, symbol: str) -> dict:
        """Reset replay and trading together, preserving simulation configuration."""
        replay = self.replay.reset()
        self.replace_trading(self._new_trading())
        if replay["index"] >= 0:
            self.trading.on_candle(replay["candle"], replay["index"], symbol)
            self.replace_history([{
                "type": "market_step",
                "replayIndex": replay["index"],
                "payload": {"symbol": symbol},
            }])
        else:
            self.replace_history([])
        return replay

    def reset_trading(self, symbol: str) -> None:
        """Reset only trading state while retaining the current replay position."""
        previous = self.trading
        replay_index = self.replay.index
        balance = previous.account.starting_balance
        fee_rate = previous.fee_rate
        margin_rate = previous.margin_rate
        maint_margin_rate = previous.maint_margin_rate
        if replay_index < 0:
            self.replace_trading(PaperTradingEngine(balance, fee_rate, margin_rate, maint_margin_rate))
            self.replace_history([deepcopy(event) for event in self.history if event.get("type") in {"market_step", "candle"}])
            return
        market_history = [deepcopy(event) for event in self.history if event.get("type") in {"market_step", "candle"}]
        has_context = any(
            event.get("replayIndex") == replay_index and event.get("payload", {}).get("symbol") == symbol
            for event in market_history
        )
        if not has_context:
            market = previous.get_latest_market(symbol)
            candle = market["candle"] if market and market.get("index") == replay_index else self.replay.candles[replay_index]
            market_history.append({
                "type": "candle",
                "replayIndex": replay_index,
                "payload": {"candle": deepcopy(candle), "index": replay_index, "symbol": symbol},
            })
        self.replace_trading(rebuild_trading(
            self.replay,
            market_history,
            replay_index,
            default_symbol=symbol,
            starting_balance=balance,
            fee_rate=fee_rate,
            margin_rate=margin_rate,
            maint_margin_rate=maint_margin_rate,
        ))
        self.replace_history(market_history)

    def reset(self, symbol: str) -> dict:
        """Compatibility alias for a full replay reset."""
        return self.reset_replay(symbol)

    def submit_order(self, symbol, side, quantity, order_type="market", limit_price=None, stop_price=None):
        created = self.trading.submit(symbol, side, quantity, order_type, limit_price, stop_price, created_index=self.replay.index)
        self.record("order", self.replay.index, {"symbol": symbol, "side": side, "quantity": quantity, "type": order_type, "limitPrice": limit_price, "stopPrice": stop_price})
        return created

    def close_position(self, symbol, price, quantity=None, timestamp=None):
        trade = self.trading.close(symbol, price, quantity=quantity, timestamp=timestamp)
        self.record("close", self.replay.index, {"symbol": symbol, "quantity": quantity, "price": price, "timestamp": timestamp})
        return trade

    def apply_funding(self, rate, timestamp=None, symbol=None, mark_price=None):
        events = self.trading.apply_funding(rate, timestamp=timestamp, symbol=symbol, mark_price=mark_price)
        if events:
            self.record("funding", self.replay.index, {"rate": rate, "timestamp": timestamp, "symbol": symbol, "markPrice": mark_price})
        return events

    def cancel_order(self, order_id):
        order = self.trading.cancel(order_id)
        self.record("cancel", self.replay.index, {"orderId": order_id})
        return order

    def cancel_all(self, reason=None):
        pending = list(self.trading.pending_orders())
        cancelled = [self.trading.cancel(order["id"]) for order in pending]
        if reason:
            reason = str(reason)
            for order in cancelled:
                order["cancelReason"] = reason
                self.trading.orders[order["id"]]["cancelReason"] = reason
        if cancelled:
            self.record("cancel_all", self.replay.index, {"reason": reason})
        return cancelled

    def set_risk(self, symbol, stop_loss=None, take_profit=None):
        position = self.trading.set_risk(symbol, stop_loss, take_profit)
        self.record("risk", self.replay.index, {"symbol": symbol, "stopLoss": stop_loss, "takeProfit": take_profit})
        return position

    def clear_risk(self, symbol, target="all"):
        if target == "stopLoss":
            position = self.trading.clear_stop_loss(symbol)
        elif target == "takeProfit":
            position = self.trading.clear_take_profit(symbol)
        else:
            position = self.trading.clear_risk(symbol)
        self.record("clear_risk", self.replay.index, {"symbol": symbol, "target": target})
        return position

    def process_candle(self, candle, index, symbol, *, record=True):
        events = self.trading.on_candle(candle, index, symbol)
        if record:
            self.record("candle", index, {"candle": deepcopy(candle), "index": index, "symbol": symbol})
        return events

    def set_starting_balance(self, balance):
        self.trading.set_starting_balance(balance)
        self.record("capital", -1, {"balance": balance})
        return self.trading

    def set_fee_rate(self, rate):
        result = self.trading.set_fee_rate(rate)
        self.record("fee_rate", self.replay.index, {"rate": rate})
        return result
