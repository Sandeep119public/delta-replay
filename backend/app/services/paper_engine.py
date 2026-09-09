from copy import deepcopy
from math import isfinite

from ..domain.account import TradingAccount
from ..domain.ambiguity import evaluate


class PaperTradingEngine:
    def __init__(self, starting_balance=10000.0, fee_rate=0.0005, margin_rate=0.1, maint_margin_rate=0.05):
        self.margin_rate = float(margin_rate)
        self.maint_margin_rate = float(maint_margin_rate)
        self.fee_rate = float(fee_rate)
        if not 0 < self.margin_rate <= 1:
            raise ValueError("margin rate must be in (0, 1]")
        if not 0 <= self.maint_margin_rate <= self.margin_rate:
            raise ValueError("maintenance margin rate must be in [0, margin_rate]")
        if not 0 <= self.fee_rate < 1:
            raise ValueError("fee rate must be in [0, 1)")
        self.account = TradingAccount(float(starting_balance))
        self.positions = {}
        self.orders = {}
        self.trades = []
        self.index = -1
        self._next_order = 1

    @staticmethod
    def _positive_finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be numeric") from exc
        if not isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be finite and positive")
        return value

    @staticmethod
    def _integer(value, name):
        if isinstance(value, bool):
            raise ValueError(f"{name} must be an integer")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
        if not isfinite(numeric) or numeric != int(numeric):
            raise ValueError(f"{name} must be an integer")
        return int(numeric)

    def fee(self, price, quantity):
        return abs(self._positive_finite(price, "price") * self._positive_finite(quantity, "quantity")) * self.fee_rate

    def has_open_position(self, symbol=None):
        return bool(self.positions) if symbol is None else symbol in self.positions

    def pending_orders(self):
        return [o for o in self.orders.values() if o["status"] == "PENDING"]

    def mark(self, symbol, price):
        price = self._positive_finite(price, "price")
        if symbol in self.positions:
            self.positions[symbol]["current_price"] = price
        self._recalc()

    def _recalc(self):
        unrealized = used = maintenance = 0.0
        for position in self.positions.values():
            sign = 1 if position["side"] == "long" else -1
            mark = position["current_price"]
            unrealized += (mark - position["entry_price"]) * position["quantity"] * sign
            used += position["entry_price"] * position["quantity"] * self.margin_rate
            maintenance += mark * position["quantity"] * self.maint_margin_rate
        self.account.unrealized_pnl = unrealized
        self.account.used_margin = used
        self.account.maintenance_margin = maintenance
        self.account.validate_invariants()

    def submit(self, symbol, side, quantity, type="market", limit_price=None, stop_price=None):
        symbol = str(symbol).strip().upper()
        if not symbol:
            raise ValueError("symbol must be provided")
        if side not in ("buy", "sell"):
            raise ValueError("side must be buy or sell")
        quantity = self._positive_finite(quantity, "quantity")
        if type not in ("market", "limit", "stop_market"):
            raise ValueError("unsupported order type")
        if type == "limit" or limit_price is not None:
            limit_price = self._positive_finite(limit_price, "limit_price") if limit_price is not None else None
        if type == "stop_market" or stop_price is not None:
            stop_price = self._positive_finite(stop_price, "stop_price") if stop_price is not None else None
        if type == "limit" and limit_price is None:
            raise ValueError("limit_price must be provided")
        if type == "stop_market" and stop_price is None:
            raise ValueError("stop_price must be provided")
        if self.has_open_position(symbol):
            raise ValueError("position already open")
        order = {"id": self._next_order, "symbol": symbol, "side": side, "type": type, "quantity": quantity, "limitPrice": limit_price, "stopPrice": stop_price, "status": "PENDING", "createdIndex": self.index, "filledPrice": None}
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
        self.account.realized_pnl -= fee
        self.account.total_fees += fee
        self.account.validate_invariants()
        self.positions[symbol] = {"symbol": symbol, "side": side, "quantity": order["quantity"], "entry_price": price, "current_price": price, "opened_at": candle.get("time"), "opened_index": self.index, "entry_fee": fee, "stop_loss": None, "take_profit": None, "stop_loss_created_index": -1, "take_profit_created_index": -1}

    def close(self, symbol, price, reason="MARKET", ambiguity="NONE", timestamp=None, quantity=None):
        price = self._positive_finite(price, "price")
        position = self.positions.get(symbol)
        if not position:
            return None
        qty = position["quantity"] if quantity is None else self._positive_finite(quantity, "quantity")
        if qty > position["quantity"]:
            raise ValueError("invalid close quantity")
        gross = (price - position["entry_price"]) * qty * (1 if position["side"] == "long" else -1)
        exit_fee = self.fee(price, qty)
        entry_fee = position["entry_fee"] * (qty / position["quantity"])
        net = gross - entry_fee - exit_fee
        self.account.wallet_balance += gross - exit_fee
        self.account.realized_pnl += gross - exit_fee
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
            if index <= self.index:
                raise ValueError("candle index must advance monotonically")
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
                touched = (order["side"] == "buy" and candle["low"] <= order["limitPrice"]) or (order["side"] == "sell" and candle["high"] >= order["limitPrice"])
                if touched:
                    price = min(order["limitPrice"], candle["open"]) if order["side"] == "buy" else max(order["limitPrice"], candle["open"])
            elif order["type"] == "stop_market":
                touched = (order["side"] == "buy" and candle["high"] >= order["stopPrice"]) or (order["side"] == "sell" and candle["low"] <= order["stopPrice"])
                if touched:
                    price = max(order["stopPrice"], candle["open"]) if order["side"] == "buy" else min(order["stopPrice"], candle["open"])
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
                events.append({"type": "LIQUIDATION", "trade": trade, "symbol": sym, "liquidationPrice": candle["close"]})
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
        entry = position["entry_price"]
        side = position["side"]
        next_stop = self._positive_finite(stop_loss, "stop_loss") if stop_loss is not None else None
        next_take = self._positive_finite(take_profit, "take_profit") if take_profit is not None else None
        if next_stop is not None and ((side == "long" and next_stop >= entry) or (side == "short" and next_stop <= entry)):
            raise ValueError("stop_loss must be below entry for long or above entry for short")
        if next_take is not None and ((side == "long" and next_take <= entry) or (side == "short" and next_take >= entry)):
            raise ValueError("take_profit must be above entry for long or below entry for short")
        if stop_loss is not None:
            position["stop_loss"] = next_stop
            position["stop_loss_created_index"] = self.index
        if take_profit is not None:
            position["take_profit"] = next_take
            position["take_profit_created_index"] = self.index
        return position

    def clear_risk(self, symbol):
        return self._clear_risk(symbol, stop_loss=True, take_profit=True)

    def clear_stop_loss(self, symbol):
        return self._clear_risk(symbol, stop_loss=True, take_profit=False)

    def clear_take_profit(self, symbol):
        return self._clear_risk(symbol, stop_loss=False, take_profit=True)

    def _clear_risk(self, symbol, *, stop_loss, take_profit):
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        if stop_loss:
            position["stop_loss"] = None
            position["stop_loss_created_index"] = -1
        if take_profit:
            position["take_profit"] = None
            position["take_profit_created_index"] = -1
        return position

    def set_starting_balance(self, balance):
        balance = float(balance)
        if not isfinite(balance) or balance <= 0:
            raise ValueError("starting balance must be finite and positive")
        if self.has_open_position() or self.pending_orders():
            raise ValueError("close positions and cancel pending orders before changing starting balance")
        self.__init__(balance, self.fee_rate, self.margin_rate, self.maint_margin_rate)
        return self

    def set_fee_rate(self, rate):
        rate = float(rate)
        if not isfinite(rate) or rate < 0 or rate >= 1:
            raise ValueError("fee rate must be in [0, 1)")
        self.fee_rate = rate
        return self

    def snapshot(self):
        self._recalc()
        return {"account": self.account.snapshot(), "positions": list(self.positions.values()), "orders": list(self.orders.values()), "pendingOrders": self.pending_orders(), "trades": list(self.trades), "index": self.index}

    def export_state(self):
        self._validate_state()
        return {"marginRate": self.margin_rate, "maintenanceMarginRate": self.maint_margin_rate, "feeRate": self.fee_rate, "account": self.account.export_state(), "positions": deepcopy(self.positions), "orders": deepcopy(self.orders), "trades": deepcopy(self.trades), "index": self.index, "nextOrder": self._next_order}

    def _validate_state(self):
        if not 0 < self.margin_rate <= 1:
            raise ValueError("marginRate must be in (0, 1]")
        if not 0 <= self.maint_margin_rate <= self.margin_rate:
            raise ValueError("maintenanceMarginRate must be in [0, marginRate]")
        if not 0 <= self.fee_rate < 1:
            raise ValueError("feeRate must be in [0, 1)")
        if not isinstance(self.index, int) or self.index < -1:
            raise ValueError("trading index must be >= -1")
        if not isinstance(self._next_order, int) or self._next_order <= 0:
            raise ValueError("next order id must be positive")
        self.account.validate_invariants()
        allowed_statuses = {"PENDING", "FILLED", "CANCELLED", "REJECTED"}
        order_ids = []
        for key, order in self.orders.items():
            try:
                order_id = int(key)
            except (TypeError, ValueError) as exc:
                raise ValueError("order id must be an integer") from exc
            if order_id <= 0 or not isinstance(order, dict) or order.get("id") != order_id:
                raise ValueError("invalid order state")
            if not isinstance(order.get("symbol"), str) or not order["symbol"].strip():
                raise ValueError("order symbol must be non-empty")
            if order.get("side") not in ("buy", "sell") or order.get("type") not in ("market", "limit", "stop_market"):
                raise ValueError("order side or type is invalid")
            self._positive_finite(order.get("quantity"), "order quantity")
            if order.get("createdIndex") is None or self._integer(order["createdIndex"], "order createdIndex") < -1:
                raise ValueError("order createdIndex is invalid")
            if order.get("status") not in allowed_statuses:
                raise ValueError("order status is invalid")
            if order["type"] == "limit" and order.get("limitPrice") is None:
                raise ValueError("limit order requires limitPrice")
            if order["type"] == "stop_market" and order.get("stopPrice") is None:
                raise ValueError("stop order requires stopPrice")
            for field in ("limitPrice", "stopPrice", "filledPrice"):
                if order.get(field) is not None:
                    self._positive_finite(order[field], field)
            if order["status"] == "PENDING" and order.get("filledPrice") is not None:
                raise ValueError("pending order cannot have a filled price")
            if order["status"] == "FILLED" and order.get("filledPrice") is None:
                raise ValueError("filled order requires a filled price")
            order_ids.append(order_id)
        if order_ids and self._next_order <= max(order_ids):
            raise ValueError("next order id must exceed all existing order ids")
        for symbol, position in self.positions.items():
            if not isinstance(symbol, str) or not symbol.strip() or not isinstance(position, dict) or position.get("symbol") != symbol:
                raise ValueError("invalid position state")
            if position.get("side") not in ("long", "short"):
                raise ValueError("position side is invalid")
            for field in ("quantity", "entry_price", "current_price", "entry_fee"):
                self._positive_finite(position.get(field), f"position {field}")
            for field in ("stop_loss", "take_profit"):
                if position.get(field) is not None:
                    self._positive_finite(position[field], field)
            for field in ("stop_loss_created_index", "take_profit_created_index", "opened_index"):
                if field in position and self._integer(position[field], f"position {field}") < -1:
                    raise ValueError(f"position {field} is invalid")
        for trade in self.trades:
            if not isinstance(trade, dict):
                raise ValueError("trade must be an object")
            for field in ("quantity", "entryPrice", "exitPrice"):
                self._positive_finite(trade.get(field), f"trade {field}")
        return self

    @classmethod
    def from_state(cls, state):
        if not isinstance(state, dict):
            raise ValueError("trading state must be an object")
        required = ("marginRate", "maintenanceMarginRate", "feeRate", "account", "positions", "orders", "trades", "index", "nextOrder")
        missing = [key for key in required if key not in state]
        if missing:
            raise ValueError(f"trading state missing fields: {', '.join(missing)}")
        if not isinstance(state["positions"], dict) or not isinstance(state["orders"], dict) or not isinstance(state["trades"], list):
            raise ValueError("invalid trading collection state")
        try:
            starting_balance = float(state["account"]["startingBalance"])
            fee_rate = float(state["feeRate"])
            margin_rate = float(state["marginRate"])
            maint_margin_rate = float(state["maintenanceMarginRate"])
        except (TypeError, ValueError, KeyError) as exc:
            raise ValueError("invalid trading configuration") from exc
        engine = cls(starting_balance, fee_rate, margin_rate, maint_margin_rate)
        engine.account = TradingAccount.from_state(state["account"])
        engine.positions = deepcopy(state["positions"])
        try:
            engine.orders = {int(key): deepcopy(value) for key, value in state["orders"].items()}
        except (TypeError, ValueError) as exc:
            raise ValueError("order ids must be integers") from exc
        engine.trades = deepcopy(state["trades"])
        try:
            engine.index = engine._integer(state["index"], "trading index")
            engine._next_order = engine._integer(state["nextOrder"], "nextOrder")
        except ValueError as exc:
            raise ValueError("trading index and nextOrder must be integers") from exc
        engine._validate_state()
        engine._recalc()
        return engine
