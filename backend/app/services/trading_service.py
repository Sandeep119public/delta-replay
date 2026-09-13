"""Compatibility facade over the canonical paper-trading engine.

New code should use :class:`PaperTradingEngine` directly. This facade exists only
for older integrations that still construct ``TradingService``.
"""

from ..models import OrderRequest
from .paper_engine import PaperTradingEngine

TAKER_FEE_RATE = 0.0005
DEFAULT_MARGIN_RATE = 1.0
DEFAULT_MAINTENANCE_RATE = 0.5


class TradingService:
    def __init__(
        self,
        starting_balance: float = 10000.0,
        fee_rate: float = TAKER_FEE_RATE,
        margin_rate: float = DEFAULT_MARGIN_RATE,
        maintenance_rate: float = DEFAULT_MAINTENANCE_RATE,
    ):
        self.engine = PaperTradingEngine(
            starting_balance=starting_balance,
            fee_rate=fee_rate,
            margin_rate=margin_rate,
            maint_margin_rate=maintenance_rate,
        )

    @property
    def starting_balance(self):
        return self.engine.account.starting_balance

    @property
    def balance(self):
        return self.engine.account.wallet_balance

    @property
    def fee_rate(self):
        return self.engine.fee_rate

    @property
    def margin_rate(self):
        return self.engine.margin_rate

    @property
    def maintenance_rate(self):
        return self.engine.maint_margin_rate

    @property
    def total_fees(self):
        return self.engine.account.total_fees

    @property
    def position(self):
        return next(iter(self.engine.positions.values()), None)

    @property
    def positions(self):
        return self.engine.positions

    def snapshot(self, mark_price: float | None = None):
        position = self.position
        if mark_price is not None and position:
            self.engine.mark(position["symbol"], mark_price)
        account = self.engine.snapshot()["account"]
        return {
            "balance": account["walletBalance"],
            "equity": account["equity"],
            "unrealizedPnl": account["unrealizedPnL"],
            "initialMargin": account["initialMargin"],
            "maintenanceMargin": account["maintenanceMargin"],
            "availableMargin": account["availableMargin"],
            "totalFees": account["totalFees"],
            "position": self.position,
        }

    def open(self, order: OrderRequest, price: float, symbol: str = "DEFAULT"):
        order_data = self.engine.submit(symbol, order.side, order.quantity)
        self.engine.on_candle(
            {
                "time": self.engine.index + 1,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": 0,
            },
            self.engine.index + 1,
            symbol,
        )
        return self.snapshot(price)

    def open_order(self, order, price: float):
        return self.open(OrderRequest(side=order.side, quantity=order.quantity), price, order.symbol)

    def close(self, price: float, symbol: str = "DEFAULT"):
        self.engine.close(symbol, price)
        return self.snapshot(price)

    def set_risk(self, stop_loss=None, take_profit=None, symbol: str = "DEFAULT"):
        return self.engine.set_risk(symbol, stop_loss, take_profit)

    def process_candle(self, candle, policy="conservative", symbol="DEFAULT"):
        events = self.engine.on_candle(candle, self.engine.index + 1, symbol)
        return {"event": events[-1] if events else None, **self.snapshot(candle.get("close"))}

    def reset(self):
        balance = self.engine.account.starting_balance
        self.engine = PaperTradingEngine(
            starting_balance=balance,
            fee_rate=self.engine.fee_rate,
            margin_rate=self.engine.margin_rate,
            maint_margin_rate=self.engine.maint_margin_rate,
        )
        return self.snapshot()
