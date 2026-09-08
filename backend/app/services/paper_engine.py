from ..domain.account import TradingAccount
from ..domain.ambiguity import evaluate


class PaperTradingEngine:
    def __init__(self, starting_balance=10000.0, fee_rate=0.0005, margin_rate=0.1, maint_margin_rate=0.05):
        self.margin_rate = float(margin_rate)
        self.maint_margin_rate = float(maint_margin_rate)
        self.fee_rate = float(fee_rate)
        self.account = TradingAccount(float(starting_balance))
        self.positions = {}
        self.orders = {}
        self.trades = []
        self.index = -1
        self._next_order = 1

    def fee(self, price, quantity):
        return abs(price * quantity) * self.fee_rate

    def has_open_position(self, symbol=None):
        return bool(self.positions) if symbol is None else symbol in self.positions

    def pending_orders(self):
        return [o for o in self.orders.values() if o["status"] == "PENDING"]

    def mark(self, symbol, price):
        if symbol in self.positions:
            self.positions[symbol]["current_price"] = price
        self._recalc()

    def _recalc(self):
        unrealized = used = maintenance = 0.0
        for position in self.positions.values():
            sign = 1 if position["side"] == "long" else -1
            mark = position["current_price"]
            unrealized += (mark - position["entry_price"]) * position["quantity"] * sign
            used += mark * position["quantity"] * self.margin_rate
            maintenance += mark * position["quantity"] * self.maint_margin_rate
        self.account.unrealized_pnl = unrealized
        self.account.used_margin = used
        self.account.maintenance_margin = maintenance

    def submit(self, symbol, side, quantity, type="market", limit_price=None, stop_price=None):
        symbol = str(symbol).strip().upper()
        if not symbol:
            raise ValueError("symbol must be provided")
        if side not in ("buy", "sell"):
            raise ValueError("side must be buy or sell")
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if type not in ("market", "limit", "stop_market"):
            raise ValueError("unsupported order type")
        if type == "limit" and (limit_price is None or limit_price <= 0):
            raise ValueError("limit_price required")
        if type == "stop_market" and (stop_price is None or stop_price <= 0):
            raise ValueError("stop_price required")
        if self.has_open_position(symbol):
            raise ValueError("position already open")

        order = {
            "id": self._next_order,
            "symbol": symbol,
            "side": side,
            "type": type,
            "quantity": float(quantity),
            "limitPrice": limit_price,
            "stopPrice": stop_price,
            "status": "PENDING",
            "createdIndex": self.index,
            "filledPrice": None,
        }
        self.orders[order["id"]] = order
        self._next_order += 1
        return order

    def _open(self, order, price, candle):
        symbol = order["symbol"]
        side = "long" if order["side"] == "buy" else "short"
        fee = self.fee(price, order["quantity"])
        required_margin = price * order["quantity"] * self.margin_rate + fee
        self._recalc()
        if symbol in self.positions:
            raise ValueError("position already open")
        if self.account.available_margin < required_margin:
            raise ValueError("insufficient margin")

        self.account.wallet_balance -= fee
        self.account.total_fees += fee
        self.positions[symbol] = {
            "symbol": symbol,
            "side": side,
            "quantity": order["quantity"],
            "entry_price": price,
            "current_price": price,
            "opened_at": candle.get("time"),
            "opened_index": self.index,
            "entry_fee": fee,
            "stop_loss": None,
            "take_profit": None,
            "stop_loss_created_index": -1,
            "take_profit_created_index": -1,
        }

    def close(self, symbol, price, reason="MARKET", ambiguity="NONE", timestamp=None, quantity=None):
        if price <= 0:
            raise ValueError("price must be positive")
        position = self.positions.get(symbol)
        if not position:
            return None
        qty = position["quantity"] if quantity is None else quantity
        if qty <= 0 or qty > position["quantity"]:
            raise ValueError("invalid close quantity")

        gross = (price - position["entry_price"]) * qty * (1 if position["side"] == "long" else -1)
        exit_fee = self.fee(price, qty)
        entry_fee = position["entry_fee"] * (qty / position["quantity"])
        net = gross - entry_fee - exit_fee

        self.account.wallet_balance += gross - exit_fee
        self.account.realized_pnl += net
        self.account.total_fees += exit_fee

        trade = {
            "id": len(self.trades) + 1,
            "symbol": symbol,
            "side": position["side"].upper(),
            "quantity": qty,
            "entryPrice": position["entry_price"],
            "exitPrice": price,
            "openedAt": position["opened_at"],
            "closedAt": timestamp,
            "realizedPnL": net,
            "grossPnL": gross,
            "entryFee": entry_fee,
            "exitFee": exit_fee,
            "totalFee": entry_fee + exit_fee,
            "netPnL": net,
            "exitReason": reason,
            "ambiguityResolution": ambiguity,
        }
        self.trades.append(trade)

        if qty == position["quantity"]:
            del self.positions[symbol]
        else:
            position["quantity"] -= qty
            position["entry_fee"] -= entry_fee

        self._recalc()
        return trade

    def on_candle(self, candle, index=None, symbol="BTCUSDT"):
        symbol = str(symbol).strip().upper()
        self.index = self.index + 1 if index is None else int(index)
        events = []

        for order in self.orders.values():
            if order["status"] != "PENDING" or order["symbol"] != symbol:
                continue

            price = None
            if order["type"] == "market" and self.index >= order["createdIndex"] + 2:
                price = candle["open"]
            elif order["type"] == "limit":
                touched = ((order["side"] == "buy" and candle["low"] <= order["limitPrice"]) or
                           (order["side"] == "sell" and candle["high"] >= order["limitPrice"]))
                if touched:
                    price = (min(order["limitPrice"], candle["open"]) if order["side"] == "buy"
                             else max(order["limitPrice"], candle["open"]))
            elif order["type"] == "stop_market":
                touched = ((order["side"] == "buy" and candle["high"] >= order["stopPrice"]) or
                           (order["side"] == "sell" and candle["low"] <= order["stopPrice"]))
                if touched:
                    price = (max(order["stopPrice"], candle["open"]) if order["side"] == "buy"
                             else min(order["stopPrice"], candle["open"]))

            if price is not None:
                try:
                    self._open(order, price, candle)
                    order["status"] = "FILLED"
                    order["filledPrice"] = price
                    events.append({"type": "ORDER_FILLED", "order": order["id"]})
                except ValueError as exc:
                    order["status"] = "REJECTED"
                    events.append({"type": "ORDER_REJECTED", "order": order["id"], "reason": str(exc)})

        for sym, position in list(self.positions.items()):
            position["current_price"] = candle["close"]
            result = evaluate(position, candle, self.index)
            if result["triggered"]:
                trade = self.close(
                    sym,
                    result["exitPrice"],
                    result["exitReason"],
                    result["ambiguityResolution"],
                    candle.get("time"),
                )
                events.append({
                    "type": result["exitReason"],
                    "trade": trade,
                    "symbol": sym,
                    "price": result["exitPrice"],
                })

        self._recalc()
        for sym, position in list(self.positions.items()):
            if self.account.equity <= self.account.maintenance_margin:
                trade = self.close(sym, candle["close"], "LIQUIDATION", timestamp=candle.get("time"))
                events.append({
                    "type": "LIQUIDATION",
                    "trade": trade,
                    "symbol": sym,
                    "liquidationPrice": candle["close"],
                })
        return events

    def cancel(self, order_id):
        order = self.orders.get(order_id)
        if not order:
            raise ValueError("order not found")
        if order["status"] != "PENDING":
            raise ValueError("only pending orders can be cancelled")
        order["status"] = "CANCELLED"
        return order

    def set_risk(self, symbol, stop_loss=None, take_profit=None):
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        if stop_loss is not None:
            position["stop_loss"] = float(stop_loss)
            position["stop_loss_created_index"] = self.index
        if take_profit is not None:
            position["take_profit"] = float(take_profit)
            position["take_profit_created_index"] = self.index
        return position

    def clear_risk(self, symbol):
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        position["stop_loss"] = None
        position["take_profit"] = None
        position["stop_loss_created_index"] = -1
        position["take_profit_created_index"] = -1
        return position

    def set_starting_balance(self, balance):
        balance = float(balance)
        if balance <= 0:
            raise ValueError("starting balance must be positive")
        if self.has_open_position() or self.pending_orders():
            raise ValueError("close positions and cancel pending orders before changing starting balance")
        self.account = TradingAccount(balance)
        self.trades = []
        self.index = -1
        return self

    def set_fee_rate(self, rate):
        rate = float(rate)
        if rate < 0 or rate >= 1:
            raise ValueError("fee rate must be in [0, 1)")
        self.fee_rate = rate
        return self

    def snapshot(self):
        self._recalc()
        return {
            "account": self.account.snapshot(),
            "positions": list(self.positions.values()),
            "orders": list(self.orders.values()),
            "pendingOrders": self.pending_orders(),
            "trades": list(self.trades),
            "index": self.index,
        }
