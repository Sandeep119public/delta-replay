import math
from copy import deepcopy
from typing import Optional

from ..domain.ambiguity import evaluate
from ..domain.account import AccountState
from ..domain.margin import maintenance_margin, required_margin


class PaperTradingEngine:
    def __init__(self, starting_balance=10000.0, fee_rate=0.0005, margin_rate=0.1, maint_margin_rate=0.05):
        if not math.isfinite(starting_balance) or starting_balance <= 0:
            raise ValueError("starting_balance must be positive and finite")
        if not math.isfinite(fee_rate) or fee_rate < 0 or fee_rate >= 1:
            raise ValueError("fee_rate must be in [0, 1)")
        if not math.isfinite(margin_rate) or margin_rate <= 0 or margin_rate > 1:
            raise ValueError("margin_rate must be in (0, 1]")
        if not math.isfinite(maint_margin_rate) or maint_margin_rate < 0 or maint_margin_rate > 1:
            raise ValueError("maint_margin_rate must be in [0, 1]")
        self.fee_rate = float(fee_rate)
        self.margin_rate = float(margin_rate)
        self.maint_margin_rate = float(maint_margin_rate)
        self.account = AccountState(starting_balance=float(starting_balance))
        self.positions = {}
        self.orders = {}
        self.trades = []
        self.index = -1
        self.next_order_id = 1

    @staticmethod
    def _positive_finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be a positive finite number") from exc
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be a positive finite number")
        return value

    @staticmethod
    def _integer(value, name):
        if isinstance(value, bool):
            raise ValueError(f"{name} must be an integer")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
        if not math.isfinite(numeric) or numeric != math.trunc(numeric):
            raise ValueError(f"{name} must be an integer")
        return int(numeric)

    def _recalc(self):
        unrealized = 0.0
        used = 0.0
        for position in self.positions.values():
            entry = position["entry_price"]
            current = position["current_price"]
            qty = position["quantity"]
            direction = 1 if position["side"] == "BUY" else -1
            position["unrealized_pnl"] = (current - entry) * qty * direction
            unrealized += position["unrealized_pnl"]
            used += required_margin(entry * qty, self.margin_rate)
        self.account.unrealized_pnl = unrealized
        self.account.used_margin = used
        self.account.equity = self.account.wallet_balance + unrealized
        self.account.available_margin = self.account.equity - used
        self.account.maintenance_margin = sum(maintenance_margin(p["current_price"] * p["quantity"], self.maint_margin_rate) for p in self.positions.values())
        self.account.validate_invariants()

    def has_open_position(self, symbol: Optional[str] = None):
        if symbol is None:
            return bool(self.positions)
        return str(symbol).strip().upper() in self.positions

    def pending_orders(self):
        return [o for o in self.orders.values() if o["status"] == "PENDING"]

    def mark(self, symbol, price):
        symbol = str(symbol).strip().upper()
        price = self._positive_finite(price, "price")
        position = self.positions.get(symbol)
        if position:
            position["current_price"] = price
        self._recalc()
        return self.snapshot()

    def submit(self, symbol, side, quantity, order_type="market", limit_price=None, stop_price=None):
        symbol = str(symbol).strip().upper()
        side = str(side).strip().upper()
        if not symbol:
            raise ValueError("symbol is required")
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")
        quantity = self._positive_finite(quantity, "quantity")
        order_type = str(order_type).strip().lower()
        if order_type not in {"market", "limit", "stop_market"}:
            raise ValueError("unsupported order type")
        if order_type == "limit":
            limit_price = self._positive_finite(limit_price, "limit_price")
        if order_type == "stop_market":
            stop_price = self._positive_finite(stop_price, "stop_price")
        if symbol in self.positions:
            raise ValueError("position already open")
        order = {"id": self.next_order_id, "symbol": symbol, "side": side, "quantity": quantity, "type": order_type, "limitPrice": limit_price, "stopPrice": stop_price, "status": "PENDING", "createdIndex": self.index}
        self.orders[self.next_order_id] = order
        self.next_order_id += 1
        return deepcopy(order)

    def _open(self, order, price, candle):
        symbol = order["symbol"]
        qty = order["quantity"]
        notional = price * qty
        entry_fee = notional * self.fee_rate
        required = required_margin(notional, self.margin_rate)
        if required + entry_fee > self.account.available_margin + 1e-12:
            raise ValueError("insufficient margin")
        self.account.wallet_balance -= entry_fee
        self.account.realized_pnl -= entry_fee
        self.account.total_fees += entry_fee
        self.account.validate_invariants()
        self.positions[symbol] = {"symbol": symbol, "side": order["side"], "quantity": qty, "entry_price": price, "current_price": price, "entry_fee": entry_fee, "opened_at": candle.get("time"), "created_index": self.index, "stop_loss": None, "take_profit": None}
        self._recalc()

    def close(self, symbol, price, quantity=None, reason="MANUAL", ambiguity="", timestamp=None):
        symbol = str(symbol).strip().upper()
        position = self.positions.get(symbol)
        if not position:
            return None
        price = self._positive_finite(price, "price")
        qty = position["quantity"] if quantity is None else self._positive_finite(quantity, "quantity")
        if qty > position["quantity"] + 1e-12:
            raise ValueError("close quantity exceeds position")
        direction = 1 if position["side"] == "BUY" else -1
        gross = (price - position["entry_price"]) * qty * direction
        exit_fee = price * qty * self.fee_rate
        entry_fee = position["entry_fee"] * (qty / position["quantity"])
        net = gross - exit_fee - entry_fee
        self.account.wallet_balance += gross - exit_fee
        self.account.realized_pnl += gross - exit_fee - entry_fee
        self.account.total_fees += exit_fee
        self.account.validate_invariants()
        trade = {"id": len(self.trades) + 1, "symbol": symbol, "side": position["side"].upper(), "quantity": qty, "entryPrice": position["entry_price"], "exitPrice": price, "openedAt": position["opened_at"], "closedAt": timestamp, "realizedPnL": net, "grossPnL": gross, "entryFee": entry_fee, "exitFee": exit_fee, "totalFee": entry_fee + exit_fee, "netPnL": net, "exitReason": reason, "ambiguityResolution": ambiguity}
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
        if not isinstance(candle, dict):
            raise ValueError("candle must be an object")
        for key in ("open", "high", "low", "close"):
            self._positive_finite(candle.get(key), f"candle {key}")
        if index is not None:
            index = self._integer(index, "candle index")
            if index < 0:
                raise ValueError("candle index must be non-negative")
            if index < self.index:
                raise ValueError("candle index cannot move backward")
        else:
            index = self.index + 1
        self.index = index
        events = []
        for order in self.orders.values():
            if order["status"] != "PENDING" or order["symbol"] != symbol:
                continue
            price = None
            if order["type"] == "market" and self.index > order["createdIndex"]:
                price = candle["open"]
            elif order["type"] == "limit":
                touched = (order["side"] == "BUY" and candle["low"] <= order["limitPrice"]) or (order["side"] == "SELL" and candle["high"] >= order["limitPrice"])
                if touched:
                    price = min(order["limitPrice"], candle["open"]) if order["side"] == "BUY" else max(order["limitPrice"], candle["open"])
            elif order["type"] == "stop_market":
                touched = (order["side"] == "BUY" and candle["high"] >= order["stopPrice"]) or (order["side"] == "SELL" and candle["low"] <= order["stopPrice"])
                if touched:
                    price = max(order["stopPrice"], candle["open"]) if order["side"] == "BUY" else min(order["stopPrice"], candle["open"])
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
                trade = self.close(sym, result["exitPrice"], result["exitReason"], result["ambiguityResolution"], candle.get("time"))
                events.append({"type": result["exitReason"], "trade": trade, "symbol": sym, "price": result["exitPrice"]})
        self._recalc()
        for sym in list(self.positions):
            if self.account.equity <= self.account.maintenance_margin:
                trade = self.close(sym, candle["close"], "LIQUIDATION", timestamp=candle.get("time"))
                events.append({"type": "LIQUIDATION", "trade": trade, "symbol": sym, "price": candle["close"]})
        return events

    def cancel(self, order_id):
        try:
            order_id = int(order_id)
        except (TypeError, ValueError) as exc:
            raise ValueError("invalid order id") from exc
        order = self.orders.get(order_id)
        if not order:
            raise ValueError("order not found")
        if order["status"] != "PENDING":
            raise ValueError("order is not pending")
        order["status"] = "CANCELLED"
        return deepcopy(order)

    def set_risk(self, symbol, stop_loss=None, take_profit=None):
        symbol = str(symbol).strip().upper()
        position = self.positions.get(symbol)
        if not position:
            raise KeyError("position not found")
        stop = None if stop_loss is None else self._positive_finite(stop_loss, "stop_loss")
        target = None if take_profit is None else self._positive_finite(take_profit, "take_profit")
        if stop is not None and target is not None:
            if position["side"] == "BUY" and stop >= target:
                raise ValueError("stop loss must be below take profit for BUY")
            if position["side"] == "SELL" and stop <= target:
                raise ValueError("stop loss must be above take profit for SELL")
        position["stop_loss"] = stop
        position["take_profit"] = target
        return deepcopy(position)

    def clear_risk(self, symbol):
        return self.set_risk(symbol, None, None)

    def clear_stop_loss(self, symbol):
        position = self.positions.get(str(symbol).strip().upper())
        if not position:
            raise KeyError("position not found")
        return self.set_risk(symbol, None, position["take_profit"])

    def clear_take_profit(self, symbol):
        position = self.positions.get(str(symbol).strip().upper())
        if not position:
            raise KeyError("position not found")
        return self.set_risk(symbol, position["stop_loss"], None)

    def set_starting_balance(self, balance):
        balance = self._positive_finite(balance, "starting_balance")
        self.__init__(balance, self.fee_rate, self.margin_rate, self.maint_margin_rate)
        return self.snapshot()

    def set_fee_rate(self, rate):
        if not math.isfinite(float(rate)) or float(rate) < 0 or float(rate) >= 1:
            raise ValueError("fee rate must be in [0, 1)")
        self.fee_rate = float(rate)
        return self.snapshot()

    def snapshot(self):
        return {"account": {"startingBalance": self.account.starting_balance, "walletBalance": self.account.wallet_balance, "cashBalance": self.account.wallet_balance, "equity": self.account.equity, "realizedPnL": self.account.realized_pnl, "unrealizedPnL": self.account.unrealized_pnl, "totalFees": self.account.total_fees, "availableMargin": self.account.available_margin, "usedMargin": self.account.used_margin, "maintenanceMargin": self.account.maintenance_margin}, "positions": [self._public_position(position) for position in self.positions.values()], "orders": list(self.orders.values()), "pendingOrders": self.pending_orders(), "trades": list(self.trades), "feeRate": self.fee_rate, "marginRate": self.margin_rate, "maintenanceMarginRate": self.maint_margin_rate, "index": self.index}

    @staticmethod
    def _public_position(position):
        return {"symbol": position["symbol"], "side": position["side"], "quantity": position["quantity"], "entryPrice": position["entry_price"], "currentPrice": position["current_price"], "unrealizedPnL": position["unrealized_pnl"], "stopLossPrice": position["stop_loss"], "takeProfitPrice": position["take_profit"], "openedAt": position["opened_at"]}

    def export_state(self):
        return {"account": self.account.to_dict(), "positions": deepcopy(self.positions), "orders": deepcopy(self.orders), "trades": deepcopy(self.trades), "index": self.index, "nextOrder": self.next_order_id, "feeRate": self.fee_rate, "marginRate": self.margin_rate, "maintenanceMarginRate": self.maint_margin_rate}

    @classmethod
    def from_state(cls, state):
        if not isinstance(state, dict):
            raise ValueError("trading state must be an object")
        required = ("account", "positions", "orders", "trades", "index", "nextOrder", "feeRate", "marginRate", "maintenanceMarginRate")
        missing = [key for key in required if key not in state]
        if missing:
            raise ValueError(f"trading state missing fields: {', '.join(missing)}")
        engine = cls(starting_balance=float(state["account"]["startingBalance"]), fee_rate=float(state["feeRate"]), margin_rate=float(state["marginRate"]), maint_margin_rate=float(state["maintenanceMarginRate"]))
        engine.account = AccountState.from_dict(state["account"])
        engine.positions = deepcopy(state["positions"])
        engine.orders = {int(key): deepcopy(value) for key, value in state["orders"].items()}
        engine.trades = deepcopy(state["trades"])
        engine.index = engine._integer(state["index"], "trading index")
        engine.next_order_id = engine._integer(state["nextOrder"], "next order id")
        engine._validate_state()
        return engine

    def _validate_state(self):
        if self.index < -1 or self.next_order_id <= 0:
            raise ValueError("invalid trading state indices")
        if self.account.starting_balance <= 0:
            raise ValueError("invalid account balance")
        self._recalc()
