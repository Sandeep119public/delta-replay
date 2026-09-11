from copy import deepcopy
from math import isfinite

from ..domain.account import TradingAccount
from ..domain.ambiguity import evaluate
from ..domain.errors import InsufficientMarginError, OrderRejectedError, StateInvariantError, TradingDomainError


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
        self._market_by_symbol = {}

    @staticmethod
    def _positive_finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise TradingDomainError(f"{name} must be numeric") from exc
        if not isfinite(value) or value <= 0:
            raise TradingDomainError(f"{name} must be finite and positive")
        return value

    @staticmethod
    def _non_negative_finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise TradingDomainError(f"{name} must be numeric") from exc
        if not isfinite(value) or value < 0:
            raise TradingDomainError(f"{name} must be finite and non-negative")
        return value

    @staticmethod
    def _integer(value, name):
        if isinstance(value, bool):
            raise TradingDomainError(f"{name} must be an integer")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise TradingDomainError(f"{name} must be an integer") from exc
        if not isfinite(numeric) or numeric != int(numeric):
            raise TradingDomainError(f"{name} must be an integer")
        return int(numeric)

    def _validate_account_invariants(self):
        try:
            self.account.validate_invariants()
        except (ValueError, TypeError, KeyError) as exc:
            raise StateInvariantError(f"trading account invariant violation: {exc}") from exc

    def fee(self, price, quantity):
        return abs(self._positive_finite(price, "price") * self._positive_finite(quantity, "quantity")) * self.fee_rate

    def has_open_position(self, symbol=None):
        return bool(self.positions) if symbol is None else str(symbol).strip().upper() in self.positions

    def pending_orders(self):
        return [o for o in self.orders.values() if o["status"] == "PENDING"]

    def get_latest_market(self, symbol):
        symbol = str(symbol).strip().upper()
        market = self._market_by_symbol.get(symbol)
        return deepcopy(market) if market else None

    def mark(self, symbol, price):
        symbol = str(symbol).strip().upper()
        price = self._positive_finite(price, "price")
        if symbol in self.positions:
            self.positions[symbol]["current_price"] = price
        self._market_by_symbol[symbol] = {"candle": {"close": price}, "index": self.index}
        self._recalc()
        return self.snapshot()

    def _recalc(self):
        unrealized = used = maintenance = 0.0
        for position in self.positions.values():
            sign = 1 if position["side"] == "long" else -1
            mark = self._positive_finite(position["current_price"], "position current_price")
            entry = self._positive_finite(position["entry_price"], "position entry_price")
            quantity = self._positive_finite(position["quantity"], "position quantity")
            unrealized += (mark - entry) * quantity * sign
            used += entry * quantity * self.margin_rate
            maintenance += mark * quantity * self.maint_margin_rate
        self.account.unrealized_pnl = unrealized
        self.account.used_margin = used
        self.account.maintenance_margin = maintenance
        self._validate_account_invariants()

    def submit(self, symbol, side, quantity, type="market", limit_price=None, stop_price=None):
        symbol = str(symbol).strip().upper()
        if not symbol:
            raise TradingDomainError("symbol must be provided")
        side = str(side).strip().lower()
        if side not in ("buy", "sell"):
            raise TradingDomainError("side must be buy or sell")
        quantity = self._positive_finite(quantity, "quantity")
        if type not in ("market", "limit", "stop_market"):
            raise TradingDomainError("unsupported order type")
        if type == "limit" or limit_price is not None:
            limit_price = self._positive_finite(limit_price, "limit_price") if limit_price is not None else None
        if type == "stop_market" or stop_price is not None:
            stop_price = self._positive_finite(stop_price, "stop_price") if stop_price is not None else None
        if type == "limit" and limit_price is None:
            raise TradingDomainError("limit_price required")
        if type == "stop_market" and stop_price is None:
            raise TradingDomainError("stop_price required")
        if self.has_open_position(symbol):
            raise OrderRejectedError("position already open")
        order = {"id": self._next_order, "symbol": symbol, "side": side, "type": type, "quantity": quantity, "limitPrice": limit_price, "stopPrice": stop_price, "status": "PENDING", "createdIndex": self.index, "filledPrice": None}
        self.orders[order["id"]] = order
        self._next_order += 1
        return deepcopy(order)

    def _open(self, order, price, candle):
        symbol = order["symbol"]
        side = "long" if order["side"] == "buy" else "short"
        fee = self.fee(price, order["quantity"])
        required_margin = price * order["quantity"] * self.margin_rate + fee
        self._recalc()
        if symbol in self.positions:
            raise OrderRejectedError("position already open")
        if self.account.available_margin < required_margin:
            raise InsufficientMarginError("insufficient margin")
        self.account.wallet_balance -= fee
        self.account.realized_pnl -= fee
        self.account.total_fees += fee
        self._validate_account_invariants()
        self.positions[symbol] = {"symbol": symbol, "side": side, "quantity": order["quantity"], "entry_price": price, "current_price": price, "opened_at": candle.get("time"), "opened_index": self.index, "entry_fee": fee, "stop_loss": None, "take_profit": None, "stop_loss_created_index": -1, "take_profit_created_index": -1}
        self._recalc()

    def close(self, symbol, price, reason="MARKET", ambiguity="NONE", timestamp=None, quantity=None):
        symbol = str(symbol).strip().upper()
        position = self.positions.get(symbol)
        if not position:
            return None
        price = self._positive_finite(price, "price")
        qty = position["quantity"] if quantity is None else self._positive_finite(quantity, "quantity")
        if qty > position["quantity"]:
            raise TradingDomainError("invalid close quantity")
        gross = (price - position["entry_price"]) * qty * (1 if position["side"] == "long" else -1)
        exit_fee = self.fee(price, qty)
        entry_fee = position["entry_fee"] * (qty / position["quantity"])
        net = gross - entry_fee - exit_fee
        self.account.wallet_balance += gross - exit_fee
        self.account.realized_pnl += gross - exit_fee
        self.account.total_fees += exit_fee
        self._validate_account_invariants()
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
        if not symbol:
            raise TradingDomainError("symbol must be provided")
        if not isinstance(candle, dict):
            raise TradingDomainError("candle must be an object")
        for key in ("open", "high", "low", "close"):
            self._positive_finite(candle.get(key), f"candle {key}")
        if index is not None:
            index = self._integer(index, "candle index")
            if index < 0:
                raise TradingDomainError("candle index must be non-negative")
            if index < self.index:
                raise TradingDomainError("candle index cannot move backward")
        self.index = self.index + 1 if index is None else index
        self._market_by_symbol[symbol] = {"candle": deepcopy(candle), "index": self.index}
        events = []
        for order in self.orders.values():
            if order["status"] != "PENDING" or order["symbol"] != symbol:
                continue
            price = None
            if order["type"] == "market" and self.index > order["createdIndex"]:
                price = candle["open"]
            elif order["type"] == "limit":
                touched = (order["side"] == "buy" and candle["low"] <= order["limitPrice"]) or (order["side"] == "sell" and candle["high"] >= order["limitPrice"])
                if touched: price = min(order["limitPrice"], candle["open"]) if order["side"] == "buy" else max(order["limitPrice"], candle["open"])
            elif order["type"] == "stop_market":
                touched = (order["side"] == "buy" and candle["high"] >= order["stopPrice"]) or (order["side"] == "sell" and candle["low"] <= order["stopPrice"])
                if touched: price = max(order["stopPrice"], candle["open"]) if order["side"] == "buy" else min(order["stopPrice"], candle["open"])
            if price is not None:
                try:
                    self._open(order, price, candle)
                    order["status"] = "FILLED"
                    order["filledPrice"] = price
                    events.append({"type": "ORDER_FILLED", "order": order["id"]})
                except OrderRejectedError as exc:
                    order["status"] = "REJECTED"
                    events.append({"type": "ORDER_REJECTED", "order": order["id"], "reason": str(exc)})
        position = self.positions.get(symbol)
        if position is not None:
            position["current_price"] = candle["close"]
            result = evaluate(position, candle, self.index)
            if result["triggered"]:
                trade = self.close(symbol, result["exitPrice"], result["exitReason"], result["ambiguityResolution"], candle.get("time"))
                events.append({"type": result["exitReason"], "trade": trade, "symbol": symbol, "price": result["exitPrice"]})
        self._recalc()
        if self.account.equity <= self.account.maintenance_margin:
            for sym in list(self.positions):
                market = self._market_by_symbol.get(sym)
                if not market:
                    continue
                market_candle = market["candle"]
                trade = self.close(sym, market_candle["close"], "LIQUIDATION", timestamp=market_candle.get("time"))
                events.append({"type": "LIQUIDATION", "trade": trade, "symbol": sym, "liquidationPrice": market_candle["close"]})
        return events

    def cancel(self, order_id):
        order = self.orders.get(order_id)
        if not order:
            raise TradingDomainError("order not found")
        if order["status"] != "PENDING":
            raise TradingDomainError("only pending orders can be cancelled")
        order["status"] = "CANCELLED"
        return deepcopy(order)

    def set_risk(self, symbol, stop_loss=None, take_profit=None):
        symbol = str(symbol).strip().upper()
        position = self.positions.get(symbol)
        if not position: raise TradingDomainError("no open position")
        entry = position["entry_price"]
        side = position["side"]
        stop = None if stop_loss is None else self._positive_finite(stop_loss, "stop_loss")
        target = None if take_profit is None else self._positive_finite(take_profit, "take_profit")
        if stop is not None and ((side == "long" and stop >= entry) or (side == "short" and stop <= entry)): raise TradingDomainError("stop_loss must be below entry for long or above entry for short")
        if target is not None and ((side == "long" and target <= entry) or (side == "short" and target >= entry)): raise TradingDomainError("take_profit must be above entry for long or below entry for short")
        if stop is not None and target is not None and ((side == "long" and stop >= target) or (side == "short" and stop <= target)): raise TradingDomainError("stop loss and take profit are ordered incorrectly")
        position["stop_loss"] = stop
        position["take_profit"] = target
        position["stop_loss_created_index"] = self.index if stop is not None else -1
        position["take_profit_created_index"] = self.index if target is not None else -1
        return deepcopy(position)

    def clear_risk(self, symbol): return self._clear_risk(symbol, stop_loss=True, take_profit=True)
    def clear_stop_loss(self, symbol): return self._clear_risk(symbol, stop_loss=True, take_profit=False)
    def clear_take_profit(self, symbol): return self._clear_risk(symbol, stop_loss=False, take_profit=True)

    def _clear_risk(self, symbol, *, stop_loss, take_profit):
        symbol = str(symbol).strip().upper()
        position = self.positions.get(symbol)
        if not position: raise TradingDomainError("no open position")
        if stop_loss: position["stop_loss"], position["stop_loss_created_index"] = None, -1
        if take_profit: position["take_profit"], position["take_profit_created_index"] = None, -1
        return deepcopy(position)

    def set_starting_balance(self, balance):
        balance = self._positive_finite(balance, "starting balance")
        if self.has_open_position() or self.pending_orders(): raise TradingDomainError("close positions and cancel pending orders before changing starting balance")
        fee_rate, margin_rate, maint_margin_rate = self.fee_rate, self.margin_rate, self.maint_margin_rate
        self.__init__(balance, fee_rate, margin_rate, maint_margin_rate)
        return self

    def set_fee_rate(self, rate):
        rate = self._non_negative_finite(rate, "fee rate")
        if rate >= 1: raise TradingDomainError("fee rate must be in [0, 1)")
        self.fee_rate = rate
        return self

    def snapshot(self):
        self._recalc()
        return {"account": self.account.snapshot(), "positions": [deepcopy(p) for p in self.positions.values()], "orders": [deepcopy(o) for o in self.orders.values()], "pendingOrders": [deepcopy(o) for o in self.pending_orders()], "trades": deepcopy(self.trades), "index": self.index}

    def export_state(self):
        self._validate_state()
        return {"marginRate": self.margin_rate, "maintenanceMarginRate": self.maint_margin_rate, "feeRate": self.fee_rate, "account": self.account.export_state(), "positions": deepcopy(self.positions), "orders": deepcopy(self.orders), "trades": deepcopy(self.trades), "index": self.index, "nextOrder": self._next_order}

    def _validate_state(self):
        try:
            if not 0 < self.margin_rate <= 1 or not 0 <= self.maint_margin_rate <= self.margin_rate or not 0 <= self.fee_rate < 1: raise ValueError("invalid trading configuration")
            if not isinstance(self.index, int) or self.index < -1 or not isinstance(self._next_order, int) or self._next_order <= 0: raise ValueError("invalid trading indices")
            self.account.validate_invariants()
            allowed = {"PENDING", "FILLED", "CANCELLED", "REJECTED"}
            ids = []
            for key, order in self.orders.items():
                try: order_id = int(key)
                except (TypeError, ValueError) as exc: raise ValueError("order id must be an integer") from exc
                if order_id <= 0 or not isinstance(order, dict) or order.get("id") != order_id: raise ValueError("invalid order state")
                if order.get("side") not in ("buy", "sell") or order.get("type") not in ("market", "limit", "stop_market"): raise ValueError("invalid order contract")
                self._positive_finite(order.get("quantity"), "order quantity")
                if order.get("status") not in allowed: raise ValueError("order status is invalid")
                if order["type"] == "limit" and order.get("limitPrice") is None: raise ValueError("limit order requires limitPrice")
                if order["type"] == "stop_market" and order.get("stopPrice") is None: raise ValueError("stop order requires stopPrice")
                if order.get("limitPrice") is not None: self._positive_finite(order["limitPrice"], "limitPrice")
                if order.get("stopPrice") is not None: self._positive_finite(order["stopPrice"], "stopPrice")
                if order["status"] == "PENDING" and order.get("filledPrice") is not None: raise ValueError("pending order cannot have a filled price")
                if order["status"] == "FILLED" and order.get("filledPrice") is None: raise ValueError("filled order requires a filled price")
                if order.get("filledPrice") is not None: self._positive_finite(order["filledPrice"], "filledPrice")
                ids.append(order_id)
            if ids and self._next_order <= max(ids): raise ValueError("next order id must exceed existing order ids")
            for symbol, position in self.positions.items():
                if not isinstance(symbol, str) or not symbol.strip() or not isinstance(position, dict) or position.get("symbol") != symbol: raise ValueError("invalid position state")
                if position.get("side") not in ("long", "short"): raise ValueError("position side is invalid")
                for field in ("quantity", "entry_price", "current_price"): self._positive_finite(position.get(field), f"position {field}")
                self._non_negative_finite(position.get("entry_fee"), "position entry_fee")
                for field in ("stop_loss", "take_profit"):
                    if position.get(field) is not None: self._positive_finite(position[field], field)
                for field in ("stop_loss_created_index", "take_profit_created_index", "opened_index"):
                    if field in position and self._integer(position[field], f"position {field}") < -1: raise ValueError(f"position {field} is invalid")
            for trade in self.trades:
                if not isinstance(trade, dict): raise ValueError("trade must be an object")
                for field in ("quantity", "entryPrice", "exitPrice"): self._positive_finite(trade.get(field), f"trade {field}")
        except TradingDomainError as exc:
            raise StateInvariantError(f"invalid trading state: {exc}") from exc
        except (ValueError, TypeError, KeyError) as exc:
            raise StateInvariantError(f"invalid trading state: {exc}") from exc
        return self

    @classmethod
    def from_state(cls, state):
        if not isinstance(state, dict): raise ValueError("trading state must be an object")
        required = ("marginRate", "maintenanceMarginRate", "feeRate", "account", "positions", "orders", "trades", "index", "nextOrder")
        missing = [key for key in required if key not in state]
        if missing: raise ValueError(f"trading state missing fields: {', '.join(missing)}")
        if not isinstance(state["positions"], dict) or not isinstance(state["orders"], dict) or not isinstance(state["trades"], list): raise ValueError("invalid trading collections")
        raw_orders = state["orders"]
        normalized_orders = {}
        for key, value in raw_orders.items():
            if isinstance(key, bool): raise ValueError("order id key must be canonical")
            if isinstance(key, int):
                if key <= 0: raise ValueError("order id key must be canonical")
                order_id = key
            elif isinstance(key, str) and key.isdigit() and key != "0" and not (len(key) > 1 and key.startswith("0")):
                order_id = int(key)
            else: raise ValueError("order id key must be canonical")
            if order_id in normalized_orders: raise ValueError("duplicate order id")
            normalized_orders[order_id] = deepcopy(value)
        try:
            engine = cls(float(state["account"]["startingBalance"]), float(state["feeRate"]), float(state["marginRate"]), float(state["maintenanceMarginRate"]))
            engine.account = TradingAccount.from_state(state["account"])
            engine.positions = deepcopy(state["positions"])
            engine.orders = normalized_orders
            engine.trades = deepcopy(state["trades"])
            engine.index = int(state["index"])
            engine._next_order = int(state["nextOrder"])
        except (TypeError, ValueError, KeyError) as exc:
            raise ValueError(f"invalid trading state: {exc}") from exc
        engine._validate_state()
        engine._recalc()
        return engine
