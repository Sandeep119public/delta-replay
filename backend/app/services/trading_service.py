from ..models import OrderRequest

class TradingService:
    def __init__(self, starting_balance: float = 10000.0):
        self.starting_balance = starting_balance
        self.balance = starting_balance
        self.position = None

    def snapshot(self, mark_price: float | None = None):
        equity = self.balance
        if self.position and mark_price is not None:
            pnl = (mark_price - self.position["entry_price"]) * self.position["quantity"]
            if self.position["side"] == "short": pnl = -pnl
            equity += pnl
        return {"balance": self.balance, "equity": equity, "position": self.position}

    def open(self, order: OrderRequest, price: float):
        side = "long" if order.side == "buy" else "short"
        self.position = {"side": side, "quantity": order.quantity, "entry_price": price}
        return self.snapshot(price)

    def close(self, price: float):
        if self.position:
            qty=self.position["quantity"]; entry=self.position["entry_price"]
            pnl=(price-entry)*qty
            if self.position["side"]=="short": pnl=-pnl
            self.balance += pnl
            self.position=None
        return self.snapshot(price)

    def reset(self):
        self.balance=self.starting_balance; self.position=None
        return self.snapshot()
