from copy import deepcopy
from math import isclose, isfinite

from ..domain.account import TradingAccount
from ..domain.execution import fill_price, risk_exit
from ..domain.margin import MarginEngine


class PaperTradingEngine:
    def __init__(self, starting_balance=10000.0, fee_rate=0.0005, margin_rate=0.1, maint_margin_rate=0.05):
        self.fee_rate = float(fee_rate)
        self.margin_rate = float(margin_rate)
        self.maint_margin_rate = float(maint_margin_rate)
        if not 0 < self.margin_rate <= 1:
            raise ValueError("margin rate must be in (0, 1]")
        if not 0 <= self.maint_margin_rate <= self.margin_rate:
            raise ValueError("maintenance margin rate must be in [0, margin_rate]")
        if not 0 <= self.fee_rate < 1:
            raise ValueError("fee rate must be in [0, 1)")
        self.margin_engine = MarginEngine(self.margin_rate, self.maint_margin_rate)
        self.account = TradingAccount(float(starting_balance))
        self.positions = {}
        self.orders = {}
        self.trades = []
        self.funding = []
        self.index = -1
        self._next_order = 1
        self._market_by_symbol = {}

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
    def _non_negative_finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be numeric") from exc
        if not isfinite(value) or value < 0:
            raise ValueError(f"{name} must be finite and non-negative")
        return value

    @staticmethod
    def _finite(value, name):
        try:
            value = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be numeric") from exc
        if not isfinite(value):
            raise ValueError(f"{name} must be finite")
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

    @staticmethod
    def _symbol(value, name="symbol"):
        if not isinstance(value, str):
            raise ValueError(f"{name} must be provided")
        value = value.strip().upper()
        if not value:
            raise ValueError(f"{name} must be provided")
        return value

    @staticmethod
    def _same_candle(left, right):
        return left == right

    def fee(self, price, quantity):
        return self._positive_finite(price, "price") * self._positive_finite(quantity, "quantity") * self.fee_rate

    def pending_orders(self):
        return [self.orders[order_id] for order_id in sorted(self.orders) if self.orders[order_id]["status"] == "PENDING"]

    def has_open_position(self, symbol=None):
        if symbol is None:
            return bool(self.positions)
        return self._symbol(symbol) in self.positions

    def mark(self, symbol, price):
        symbol = self._symbol(symbol)
        price = self._positive_finite(price, "mark price")
        market = self._market_by_symbol.get(symbol)
        if market is None:
            raise ValueError(f"no market price available for {symbol}")
        market["markPrice"] = price
        if symbol in self.positions:
            self.positions[symbol]["current_price"] = price
        self._recalc()
        return self.snapshot()

    def get_latest_market(self, symbol):
        symbol = self._symbol(symbol)
        market = self._market_by_symbol.get(symbol)
        return deepcopy(market) if market is not None else None

    def export_market_state(self):
        return deepcopy(self._market_by_symbol)

    def restore_market_state(self, market_state):
        if not isinstance(market_state, dict):
            raise ValueError("market state must be an object")
        normalized = {}
        for symbol, value in market_state.items():
            symbol = self._symbol(symbol)
            if not isinstance(value, dict):
                raise ValueError("invalid market context")
            candle = value.get("candle")
            if not isinstance(candle, dict):
                raise ValueError("invalid market candle")
            self._positive_finite(candle.get("close"), "market close")
            for field in ("open", "high", "low"):
                self._positive_finite(candle.get(field), f"market candle {field}")
            normalized_candle = deepcopy(candle)
            market_index = self._integer(value.get("index"), "market index")
            if market_index < -1 or market_index > self.index:
                raise ValueError("market index is outside trading timeline")
            if market_index < 0:
                raise ValueError("market candle is invalid before the trading timeline")
            mark_price = value.get("markPrice")
            if mark_price is not None:
                mark_price = self._positive_finite(mark_price, "market mark price")
            normalized[symbol] = {"candle": normalized_candle, "index": market_index, "markPrice": mark_price}
        self._market_by_symbol = normalized
        return self

    def set_market_context(self, symbol, candle, index):
        symbol = self._symbol(symbol)
        index = self._integer(index, "market index")
        if index < 0 or index > self.index:
            raise ValueError("market index is outside trading timeline")
        normalized_candle = deepcopy(candle)
        if not isinstance(normalized_candle, dict):
            raise ValueError("market candle must be an object")
        for field in ("open", "high", "low", "close"):
            self._positive_finite(normalized_candle.get(field), f"candle {field}")
        existing = self._market_by_symbol.get(symbol)
        if existing is not None and existing["index"] == index:
            if not self._same_candle(existing["candle"], normalized_candle):
                raise ValueError("same-index candle does not match existing market context")
            return self
        self._market_by_symbol[symbol] = {"candle": normalized_candle, "index": index, "markPrice": None}
        return self

    def _recalc(self):
        unrealized = 0.0
        used_margin = 0.0
        maintenance = 0.0
        for position in self.positions.values():
            mark = self._positive_finite(position.get("current_price", position["entry_price"]), "position current price")
            direction = 1 if position["side"] == "long" else -1
            unrealized += (mark - position["entry_price"]) * position["quantity"] * direction
            used_margin += position["entry_price"] * position["quantity"] * self.margin_rate
            maintenance += mark * position["quantity"] * self.maint_margin_rate
        self.account.unrealized_pnl = unrealized
        self.account.used_margin = used_margin
        self.account.maintenance_margin = maintenance
        self.account.validate_invariants()

    def _open(self, order, price, candle):
        symbol = order["symbol"]
        side = "long" if order["side"] == "buy" else "short"
        fee = self.fee(price, order["quantity"])
        required_margin = self.margin_engine.required_entry_cash(price, order["quantity"], fee)
        self._recalc()
        if symbol in self.positions:
            raise ValueError("position already open")
        if self.account.available_margin < required_margin:
            raise ValueError("insufficient available margin")
        self.account.wallet_balance -= fee
        self.account.realized_pnl -= fee
        self.account.total_fees += fee
        self.account.validate_invariants()
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
        self._recalc()

    def submit(self, symbol, side, quantity, type="market", limit_price=None, stop_price=None, created_index=None):
        symbol = self._symbol(symbol)
        if side not in ("buy", "sell"):
            raise ValueError("side must be buy or sell")
        if type not in ("market", "limit", "stop_market"):
            raise ValueError("unsupported order type")
        quantity = self._positive_finite(quantity, "quantity")
        if type == "market" and limit_price is not None:
            raise ValueError("limit_price is only valid for limit orders")
        if type == "market" and stop_price is not None:
            raise ValueError("stop_price is only valid for stop_market orders")
        if type == "limit" and stop_price is not None:
            raise ValueError("stop_price is only valid for stop_market orders")
        if type == "limit" and limit_price is None:
            raise ValueError("limit order requires limit_price")
        if type == "stop_market" and limit_price is not None:
            raise ValueError("limit_price is only valid for limit orders")
        if type == "stop_market" and stop_price is None:
            raise ValueError("stop_market order requires stop_price")
        if self.has_open_position(symbol):
            raise ValueError("position already open")
        created_index = self.index if created_index is None else self._integer(created_index, "created index")
        if created_index < -1 or created_index > self.index:
            raise ValueError("created index must be between -1 and current index")
        if limit_price is not None:
            limit_price = self._positive_finite(limit_price, "limit_price")
        if stop_price is not None:
            stop_price = self._positive_finite(stop_price, "stop_price")
        order = {
            "id": self._next_order,
            "symbol": symbol,
            "side": side,
            "type": type,
            "quantity": quantity,
            "limitPrice": limit_price,
            "stopPrice": stop_price,
            "status": "PENDING",
            "createdIndex": created_index,
            "filledPrice": None,
        }
        self.orders[order["id"]] = order
        self._next_order += 1
        return deepcopy(order)

    def close(self, symbol, price, reason="MARKET", ambiguity="NONE", timestamp=None, quantity=None):
        symbol = self._symbol(symbol)
        position = self.positions.get(symbol)
        if position is None:
            raise ValueError("no open position")
        price = self._positive_finite(price, "close price")
        qty = position["quantity"] if quantity is None else self._positive_finite(quantity, "close quantity")
        if qty > position["quantity"]:
            raise ValueError("invalid close quantity")
        direction = 1 if position["side"] == "long" else -1
        gross = (price - position["entry_price"]) * qty * direction
        entry_fee = position["entry_fee"] * (qty / position["quantity"])
        exit_fee = self.fee(price, qty)
        net = gross - entry_fee - exit_fee
        cash_delta = gross - exit_fee
        self.account.wallet_balance += cash_delta
        self.account.realized_pnl += cash_delta
        self.account.total_fees += exit_fee
        self.account.validate_invariants()
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

    def apply_funding(self, rate, timestamp=None, symbol=None, mark_price=None):
        rate = self._finite(rate, "funding rate")
        normalized_symbol = None if symbol is None else self._symbol(symbol)
        selected = []
        for sym, position in self.positions.items():
            if normalized_symbol and sym != normalized_symbol:
                continue
            mark = mark_price if mark_price is not None else position.get("current_price", position["entry_price"])
            mark = self._positive_finite(mark, "funding mark price")
            payment = (-1 if position["side"] == "long" else 1) * mark * position["quantity"] * rate
            self.account.wallet_balance += payment
            if payment < 0:
                self.account.total_funding_paid += -payment
            else:
                self.account.total_funding_received += payment
            self.account.net_funding = self.account.total_funding_received - self.account.total_funding_paid
            event = {
                "id": len(self.funding) + 1,
                "timestamp": timestamp,
                "symbol": sym,
                "side": position["side"],
                "quantity": position["quantity"],
                "markPrice": mark,
                "fundingRate": rate,
                "payment": payment,
            }
            self.funding.append(event)
            selected.append(deepcopy(event))
        self.account.validate_invariants()
        self._recalc()
        return selected

    def on_candle(self, candle, index=None, symbol="BTCUSDT"):
        symbol = self._symbol(symbol)
        if not isinstance(candle, dict):
            raise ValueError("candle must be an object")
        normalized_candle = deepcopy(candle)
        for key in ("open", "high", "low", "close"):
            normalized_candle[key] = self._positive_finite(normalized_candle.get(key), f"candle {key}")
        if index is None:
            index = self.index + 1
        else:
            index = self._integer(index, "candle index")
        if index < 0:
            raise ValueError("candle index must be non-negative")

        if index == self.index:
            existing = self._market_by_symbol.get(symbol)
            if existing is None:
                self.set_market_context(symbol, normalized_candle, index)
                return []
            if not self._same_candle(existing["candle"], normalized_candle):
                raise ValueError("same-index candle does not match existing market context")
            return []

        if self.index == -1 and not (self.positions or self.orders or self.trades or self.funding):
            self.index = index
        elif index != self.index + 1:
            raise ValueError("candle index must advance exactly one position")
        else:
            self.index = index
        self.set_market_context(symbol, normalized_candle, self.index)
        events = []
        for order_id in sorted(self.orders):
            order = self.orders[order_id]
            if order["status"] != "PENDING" or order["symbol"] != symbol:
                continue
            price = fill_price(order, normalized_candle, candle_index=self.index)
            if price is not None:
                try:
                    self._open(order, price, normalized_candle)
                    order["status"] = "FILLED"
                    order["filledPrice"] = price
                    events.append({"type": "ORDER_FILLED", "order": order["id"]})
                except ValueError as exc:
                    order["status"] = "REJECTED"
                    events.append({"type": "ORDER_REJECTED", "order": order["id"], "reason": str(exc)})
        position = self.positions.get(symbol)
        if position is not None:
            position["current_price"] = normalized_candle["close"]
            result = risk_exit(position, normalized_candle, self.index)
            if result["triggered"]:
                trade = self.close(symbol, result["exitPrice"], result["exitReason"], result["ambiguityResolution"], normalized_candle.get("time"))
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
            raise ValueError("order not found")
        if order["status"] != "PENDING":
            raise ValueError("only pending orders can be cancelled")
        order["status"] = "CANCELLED"
        return deepcopy(order)

    def set_risk(self, symbol, stop_loss=None, take_profit=None):
        symbol = self._symbol(symbol)
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        entry = position["entry_price"]
        if stop_loss is not None:
            stop_loss = self._positive_finite(stop_loss, "stop loss")
            if (position["side"] == "long" and stop_loss >= entry) or (position["side"] == "short" and stop_loss <= entry):
                raise ValueError("stop loss is invalid for position side")
        if take_profit is not None:
            take_profit = self._positive_finite(take_profit, "take profit")
            if (position["side"] == "long" and take_profit <= entry) or (position["side"] == "short" and take_profit >= entry):
                raise ValueError("take profit is invalid for position side")
        if stop_loss is not None:
            position["stop_loss"] = stop_loss
            position["stop_loss_created_index"] = self.index
        if take_profit is not None:
            position["take_profit"] = take_profit
            position["take_profit_created_index"] = self.index
        return deepcopy(position)

    def clear_stop_loss(self, symbol):
        symbol = self._symbol(symbol)
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        position["stop_loss"] = None
        position["stop_loss_created_index"] = -1
        return deepcopy(position)

    def clear_take_profit(self, symbol):
        symbol = self._symbol(symbol)
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        position["take_profit"] = None
        position["take_profit_created_index"] = -1
        return deepcopy(position)

    def clear_risk(self, symbol):
        symbol = self._symbol(symbol)
        position = self.positions.get(symbol)
        if not position:
            raise ValueError("no open position")
        position["stop_loss"] = None
        position["take_profit"] = None
        position["stop_loss_created_index"] = -1
        position["take_profit_created_index"] = -1
        return deepcopy(position)

    def set_starting_balance(self, starting_balance):
        starting_balance = self._positive_finite(starting_balance, "starting balance")
        if self.index >= 0 or self.positions or self.orders or self.trades or self.funding:
            raise ValueError("starting balance can only change before trading activity")
        self.account = TradingAccount(starting_balance)
        self._recalc()
        return self

    def set_fee_rate(self, fee_rate):
        fee_rate = self._non_negative_finite(fee_rate, "fee rate")
        if fee_rate >= 1:
            raise ValueError("fee rate must be below 1")
        if self.index >= 0 or self.positions or self.orders or self.trades:
            raise ValueError("fee rate can only change before trading activity")
        self.fee_rate = fee_rate
        return self

    def snapshot(self):
        return {
            "account": self.account.snapshot(),
            "positions": deepcopy(dict(sorted(self.positions.items()))),
            "orders": deepcopy(dict(sorted(self.orders.items()))),
            "trades": deepcopy(self.trades),
            "funding": deepcopy(self.funding),
            "index": self.index,
        }

    def export_state(self):
        self._validate_state()
        return {
            "marginRate": self.margin_rate,
            "maintenanceMarginRate": self.maint_margin_rate,
            "feeRate": self.fee_rate,
            "account": self.account.export_state(),
            "positions": deepcopy(self.positions),
            "orders": deepcopy(self.orders),
            "trades": deepcopy(self.trades),
            "funding": deepcopy(self.funding),
            "index": self.index,
            "nextOrder": self._next_order,
        }

    def _validate_state(self):
        if not 0 < self.margin_rate <= 1 or not 0 <= self.maint_margin_rate <= self.margin_rate or not 0 <= self.fee_rate < 1:
            raise ValueError("invalid trading configuration")
        if not isinstance(self.index, int) or self.index < -1 or not isinstance(self._next_order, int) or self._next_order <= 0:
            raise ValueError("invalid trading indices")
        self.account.validate_invariants()
        allowed = {"PENDING", "FILLED", "CANCELLED", "REJECTED"}
        ids = []
        for key, order in self.orders.items():
            try:
                order_id = int(key)
            except (TypeError, ValueError) as exc:
                raise ValueError("order id must be an integer") from exc
            if order_id <= 0 or not isinstance(order, dict) or order.get("id") != order_id:
                raise ValueError("invalid order state")
            if order.get("side") not in ("buy", "sell") or order.get("type") not in ("market", "limit", "stop_market"):
                raise ValueError("invalid order contract")
            order_symbol = order.get("symbol")
            if not isinstance(order_symbol, str) or not order_symbol.strip() or order_symbol != order_symbol.strip().upper():
                raise ValueError("invalid order symbol")
            self._positive_finite(order.get("quantity"), "order quantity")
            created_index = self._integer(order.get("createdIndex"), "order createdIndex")
            if created_index < -1 or created_index > self.index:
                raise ValueError("order createdIndex is invalid")
            if order.get("status") not in allowed:
                raise ValueError("order status is invalid")
            if order["type"] == "market" and order.get("limitPrice") is not None:
                raise ValueError("market order cannot have limitPrice")
            if order["type"] == "market" and order.get("stopPrice") is not None:
                raise ValueError("market order cannot have stopPrice")
            if order["type"] == "limit" and order.get("limitPrice") is None:
                raise ValueError("limit order requires limitPrice")
            if order["type"] == "limit" and order.get("stopPrice") is not None:
                raise ValueError("limit order cannot have stopPrice")
            if order["type"] == "stop_market" and order.get("stopPrice") is None:
                raise ValueError("stop order requires stopPrice")
            if order["type"] == "stop_market" and order.get("limitPrice") is not None:
                raise ValueError("stop order cannot have limitPrice")
            if order.get("limitPrice") is not None:
                self._positive_finite(order["limitPrice"], "limitPrice")
            if order.get("stopPrice") is not None:
                self._positive_finite(order["stopPrice"], "stopPrice")
            if order["status"] == "PENDING" and order.get("filledPrice") is not None:
                raise ValueError("pending order cannot have a filled price")
            if order["status"] == "FILLED" and order.get("filledPrice") is None:
                raise ValueError("filled order requires a filled price")
            if order.get("filledPrice") is not None:
                self._positive_finite(order["filledPrice"], "filledPrice")
            ids.append(order_id)
        if ids and self._next_order <= max(ids):
            raise ValueError("next order id must exceed existing order ids")
        for symbol, position in self.positions.items():
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper() or not isinstance(position, dict) or position.get("symbol") != symbol:
                raise ValueError("invalid position state")
            if position.get("side") not in ("long", "short"):
                raise ValueError("position side is invalid")
            for field in ("quantity", "entry_price", "current_price"):
                self._positive_finite(position.get(field), f"position {field}")
            position_entry_fee = self._non_negative_finite(position.get("entry_fee"), "position entry_fee")
            expected_position_entry_fee = self.fee(position["entry_price"], position["quantity"])
            if not isclose(position_entry_fee, expected_position_entry_fee, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("position entry_fee is inconsistent with entry_price, quantity, and fee rate")
            entry = position["entry_price"]
            opened_index = self._integer(position.get("opened_index"), "position opened_index")
            if opened_index < 0 or opened_index > self.index:
                raise ValueError("position opened_index is invalid")
            if position.get("stop_loss") is not None:
                stop = self._positive_finite(position["stop_loss"], "stop loss")
                if (position["side"] == "long" and stop >= entry) or (position["side"] == "short" and stop <= entry):
                    raise ValueError("position stop loss is invalid")
            if position.get("take_profit") is not None:
                take = self._positive_finite(position["take_profit"], "take profit")
                if (position["side"] == "long" and take <= entry) or (position["side"] == "short" and take >= entry):
                    raise ValueError("position take profit is invalid")
            for field, level in (("stop_loss_created_index", position.get("stop_loss")), ("take_profit_created_index", position.get("take_profit"))):
                risk_index = self._integer(position.get(field), f"position {field}")
                if risk_index < -1 or risk_index > self.index:
                    raise ValueError(f"position {field} is invalid")
                if level is None and risk_index != -1:
                    raise ValueError(f"position {field} must be -1 when risk is cleared")
                if level is not None and risk_index < opened_index:
                    raise ValueError(f"position {field} cannot precede position opening")
        if not isinstance(self.funding, list):
            raise ValueError("funding must be a list")
        funding_ids = []
        funding_paid = 0.0
        funding_received = 0.0
        for event in self.funding:
            if not isinstance(event, dict):
                raise ValueError("funding event must be a dict")
            event_id = self._integer(event.get("id"), "funding id")
            if event_id <= 0:
                raise ValueError("funding id must be positive")
            event_symbol = event.get("symbol")
            if not isinstance(event_symbol, str) or not event_symbol.strip() or event_symbol != event_symbol.strip().upper():
                raise ValueError("funding symbol is invalid")
            if event.get("side") not in ("long", "short"):
                raise ValueError("funding side is invalid")
            quantity = self._positive_finite(event.get("quantity"), "funding quantity")
            mark_price = self._positive_finite(event.get("markPrice"), "funding markPrice")
            funding_rate = self._finite(event.get("fundingRate"), "fundingRate")
            payment = self._finite(event.get("payment"), "funding payment")
            expected_payment = (-1 if event["side"] == "long" else 1) * mark_price * quantity * funding_rate
            if not isclose(payment, expected_payment, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("funding payment is inconsistent with side, quantity, markPrice, and fundingRate")
            if payment < 0:
                funding_paid += -payment
            else:
                funding_received += payment
            funding_ids.append(event_id)
        if funding_ids != list(range(1, len(funding_ids) + 1)):
            raise ValueError("funding ids must be sequential")
        if not isclose(self.account.total_funding_paid, funding_paid, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account totalFundingPaid is inconsistent with funding events")
        if not isclose(self.account.total_funding_received, funding_received, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account totalFundingReceived is inconsistent with funding events")
        trade_ids = []
        trade_total_fees = 0.0
        trade_net_pnl = 0.0
        for trade in self.trades:
            if not isinstance(trade, dict):
                raise ValueError("trade must be a dict")
            trade_id = self._integer(trade.get("id"), "trade id")
            if trade_id <= 0:
                raise ValueError("trade id must be positive")
            trade_symbol = trade.get("symbol")
            if not isinstance(trade_symbol, str) or not trade_symbol.strip() or trade_symbol != trade_symbol.strip().upper():
                raise ValueError("trade symbol is invalid")
            if trade.get("side") not in ("LONG", "SHORT"):
                raise ValueError("trade side is invalid")
            quantity = self._positive_finite(trade.get("quantity"), "trade quantity")
            entry_price = self._positive_finite(trade.get("entryPrice"), "trade entryPrice")
            exit_price = self._positive_finite(trade.get("exitPrice"), "trade exitPrice")
            for field in ("entryFee", "exitFee", "totalFee"):
                self._non_negative_finite(trade.get(field), f"trade {field}")
            for field in ("realizedPnL", "grossPnL", "netPnL"):
                self._finite(trade.get(field), f"trade {field}")
            direction = 1 if trade["side"] == "LONG" else -1
            expected_gross = (exit_price - entry_price) * quantity * direction
            expected_entry_fee = self.fee(entry_price, quantity)
            expected_exit_fee = self.fee(exit_price, quantity)
            if not isclose(trade["grossPnL"], expected_gross, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade grossPnL is inconsistent with side, quantity, entryPrice, and exitPrice")
            if not isclose(trade["entryFee"], expected_entry_fee, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade entryFee is inconsistent with entryPrice, quantity, and fee rate")
            if not isclose(trade["exitFee"], expected_exit_fee, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade exitFee is inconsistent with exitPrice, quantity, and fee rate")
            expected_total_fee = trade["entryFee"] + trade["exitFee"]
            if not isclose(trade["totalFee"], expected_total_fee, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade totalFee is inconsistent with entryFee and exitFee")
            expected_net = trade["grossPnL"] - trade["totalFee"]
            if not isclose(trade["netPnL"], expected_net, rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade netPnL is inconsistent with grossPnL and totalFee")
            if not isclose(trade["realizedPnL"], trade["netPnL"], rel_tol=1e-9, abs_tol=1e-9):
                raise ValueError("trade realizedPnL is inconsistent with netPnL")
            trade_total_fees += trade["totalFee"]
            trade_net_pnl += trade["netPnL"]
            trade_ids.append(trade_id)
        if trade_ids != list(range(1, len(trade_ids) + 1)):
            raise ValueError("trade ids must be sequential")

        open_entry_fees = 0.0
        expected_unrealized = 0.0
        expected_used_margin = 0.0
        expected_maintenance = 0.0
        for position in self.positions.values():
            open_entry_fees += position["entry_fee"]
            direction = 1 if position["side"] == "long" else -1
            expected_unrealized += (position["current_price"] - position["entry_price"]) * position["quantity"] * direction
            expected_used_margin += position["entry_price"] * position["quantity"] * self.margin_rate
            expected_maintenance += position["current_price"] * position["quantity"] * self.maint_margin_rate

        expected_total_fees = trade_total_fees + open_entry_fees
        expected_realized = trade_net_pnl - open_entry_fees
        if not isclose(self.account.total_fees, expected_total_fees, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account totalFees is inconsistent with trades and open position fees")
        if not isclose(self.account.realized_pnl, expected_realized, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account realizedPnL is inconsistent with trades and open position fees")
        if not isclose(self.account.unrealized_pnl, expected_unrealized, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account unrealizedPnL is inconsistent with open positions")
        if not isclose(self.account.used_margin, expected_used_margin, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account usedMargin is inconsistent with open positions")
        if not isclose(self.account.maintenance_margin, expected_maintenance, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError("account maintenanceMargin is inconsistent with open positions")
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
            raise ValueError("invalid trading collections")
        raw_orders = state["orders"]
        normalized_orders = {}
        for key, value in raw_orders.items():
            if isinstance(key, bool):
                raise ValueError("order id key must be canonical")
            if isinstance(key, int):
                if key <= 0:
                    raise ValueError("order id key must be canonical")
                order_id = key
            elif isinstance(key, str) and key.isdigit() and key != "0" and not (len(key) > 1 and key.startswith("0")):
                order_id = int(key)
            else:
                raise ValueError("order id key must be canonical")
            if order_id in normalized_orders:
                raise ValueError("duplicate order id")
            normalized_orders[order_id] = deepcopy(value)
        try:
            engine = cls(
                float(state["account"]["startingBalance"]),
                float(state["feeRate"]),
                float(state["marginRate"]),
                float(state["maintenanceMarginRate"]),
            )
            engine.account = TradingAccount.from_state(state["account"])
            engine.positions = deepcopy(state["positions"])
            engine.orders = normalized_orders
            engine.trades = deepcopy(state["trades"])
            engine.funding = deepcopy(state.get("funding", []))
            engine.index = engine._integer(state["index"], "trading index")
            engine._next_order = engine._integer(state["nextOrder"], "next order id")
        except (TypeError, ValueError, KeyError) as exc:
            raise ValueError(f"invalid trading state: {exc}") from exc
        engine._validate_state()
        engine._recalc()
        return engine
