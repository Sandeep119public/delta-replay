"""Compatibility execution facade backed by the canonical trading engine."""

from ..domain.orders import Order
from .paper_engine import PaperTradingEngine


class ExecutionService:
    """Preserve the historical API while delegating all execution semantics.

    The canonical implementation is ``PaperTradingEngine``. This adapter keeps
    legacy callers source-compatible without maintaining a second fill engine.
    """

    def __init__(self, trading):
        self.trading = trading
        self.engine = trading.engine if hasattr(trading, "engine") else trading
        if not isinstance(self.engine, PaperTradingEngine):
            raise TypeError("ExecutionService requires PaperTradingEngine or TradingService")
        self.orders = {}
        self.pending = []
        self.next_id = 1

    def _sync(self):
        self.orders.clear()
        self.pending.clear()
        for raw in self.engine.orders.values():
            order = Order(
                id=raw["id"],
                symbol=raw["symbol"],
                side=raw["side"],
                type=raw["type"],
                quantity=raw["quantity"],
                status=raw["status"].lower(),
                limit_price=raw.get("limitPrice"),
                stop_price=raw.get("stopPrice"),
                created_index=raw.get("createdIndex", -1),
                filled_price=raw.get("filledPrice"),
            )
            self.orders[order.id] = order
            if order.status == "pending":
                self.pending.append(order.id)
        self.next_id = self.engine._next_order

    def place(
        self,
        symbol,
        side,
        quantity,
        type="market",
        limit_price=None,
        stop_price=None,
        index=-1,
    ):
        raw = self.engine.submit(
            symbol,
            side,
            quantity,
            type,
            limit_price,
            stop_price,
        )
        self._sync()
        return self.orders[raw["id"]]

    def cancel(self, order_id):
        raw = self.engine.cancel(order_id)
        self._sync()
        return self.orders[order_id]

    def process_candle(self, candle, index, symbol="BTCUSDT"):
        events = self.engine.on_candle(candle, index, symbol)
        self._sync()
        return events
