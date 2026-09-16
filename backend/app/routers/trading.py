from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, model_validator

from ..domain.errors import StateInvariantError
from ..models import Candle
from ..services.paper_engine import PaperTradingEngine
from ..services.session_manager import atomic_session, get_session

router = APIRouter()


class EngineOrder(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    symbol: str = Field(min_length=1, max_length=32)
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0)
    type: Literal["market", "limit", "stop_market"] = "market"
    limitPrice: float | None = Field(default=None, gt=0)
    stopPrice: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_price_fields(self):
        if self.type == "market" and (self.limitPrice is not None or self.stopPrice is not None):
            raise ValueError("market orders cannot specify limitPrice or stopPrice")
        if self.type == "limit" and self.stopPrice is not None:
            raise ValueError("limit orders cannot specify stopPrice")
        if self.type == "limit" and self.limitPrice is None:
            raise ValueError("limit orders require limitPrice")
        if self.type == "stop_market" and self.limitPrice is not None:
            raise ValueError("stop_market orders cannot specify limitPrice")
        if self.type == "stop_market" and self.stopPrice is None:
            raise ValueError("stop_market orders require stopPrice")
        return self


class RiskRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    symbol: str = Field(min_length=1, max_length=32)
    stopLoss: float | None = Field(default=None, gt=0)
    takeProfit: float | None = Field(default=None, gt=0)


class CloseRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    symbol: str = Field(min_length=1, max_length=32)
    quantity: float | None = Field(default=None, gt=0)


class MarketCandleRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    symbol: str | None = Field(default=None, min_length=1, max_length=32)
    candle: Candle | None = None
    index: StrictInt | None = None


class CapitalRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    balance: float = Field(gt=0)


class FeeRateRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    rate: float = Field(ge=0, lt=1)


class FundingRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    rate: float
    timestamp: int | None = None
    symbol: str | None = Field(default=None, min_length=1, max_length=32)
    markPrice: float | None = Field(default=None, gt=0)



def snapshot(service: PaperTradingEngine):
    state = service.snapshot()
    orders = list(state["orders"].values())
    return {
        **state,
        "positions": list(state["positions"].values()),
        "orders": orders,
        "pendingOrders": [order for order in orders if order["status"] == "PENDING"],
    }


def replay_candle(session, symbol: str):
    candle = session.replay.state().get("candle")
    if not candle:
        raise HTTPException(409, "Load data and start replay before trading")
    return candle


def require_active_replay(session, action: str):
    if session.replay.index < 0:
        raise HTTPException(409, f"Load data and start replay before {action}")


def normalize_candle(raw: dict):
    try:
        return Candle.model_validate(raw).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, f"invalid candle: {exc.errors()[0]['msg']}") from exc


def _internal_http_error(exc: StateInvariantError) -> HTTPException:
    return HTTPException(
        status_code=500,
        detail={"code": "STATE_INVARIANT_VIOLATION", "message": "Trading state integrity failure"},
    )


def _active_symbol(session, requested_symbol):
    if requested_symbol is not None:
        symbol = str(requested_symbol).strip().upper()
        if not symbol:
            raise HTTPException(422, "symbol must be provided")
        return symbol
    for command in reversed(session.history):
        if command.get("type") not in {"market_step", "candle"}:
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()
    raise HTTPException(409, "Start the replay before processing a market candle")


@router.get("/state")
def state(request: Request):
    try:
        return snapshot(get_session(request).trading)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc


@router.get("/orders")
def orders(request: Request):
    try:
        service = get_session(request).trading
        snapshot_value = snapshot(service)
        return {"orders": snapshot_value["orders"], "pendingOrders": snapshot_value["pendingOrders"]}
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc


@router.get("/trades")
def trades(request: Request):
    try:
        return {"trades": get_session(request).trading.snapshot()["trades"]}
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc


@router.get("/funding")
def funding(request: Request):
    try:
        return {"funding": get_session(request).trading.snapshot()["funding"]}
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc


@router.post("/order")
def order(request: Request, command: EngineOrder):
    def submit(session):
        require_active_replay(session, "placing an order")
        service = session.trading
        created = service.submit(command.symbol, command.side, command.quantity, command.type, command.limitPrice, command.stopPrice)
        session.record("order", session.replay.index, {"symbol": command.symbol, "side": command.side, "quantity": command.quantity, "type": command.type, "limitPrice": command.limitPrice, "stopPrice": command.stopPrice})
        return {"order": created, **snapshot(service)}
    try:
        return atomic_session(request, submit)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/close")
def close(request: Request, command: CloseRequest):
    def close_position(session):
        require_active_replay(session, "closing a position")
        market = session.trading.get_latest_market(command.symbol)
        if not market or not market.get("candle", {}).get("close"):
            raise HTTPException(409, f"No market price available for {command.symbol}")
        candle = market["candle"]
        price = float(candle["close"])
        trade = session.trading.close(command.symbol, price, quantity=command.quantity, timestamp=candle.get("time"))
        if not trade:
            raise HTTPException(422, "no open position")
        session.record("close", session.replay.index, {"symbol": command.symbol, "quantity": command.quantity, "price": price, "timestamp": candle.get("time")})
        return {"trade": trade, **snapshot(session.trading)}
    try:
        return atomic_session(request, close_position)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/funding")
def apply_funding(request: Request, command: FundingRequest):
    def apply(session):
        require_active_replay(session, "applying funding")
        if not session.trading.has_open_position(command.symbol):
            if command.symbol is None and session.trading.has_open_position():
                pass
            else:
                raise HTTPException(409, "Funding requires an open position")
        events = session.trading.apply_funding(command.rate, timestamp=command.timestamp, symbol=command.symbol, mark_price=command.markPrice)
        if not events:
            raise HTTPException(409, "Funding requires an open position")
        session.record("funding", session.replay.index, {"rate": command.rate, "timestamp": command.timestamp, "symbol": command.symbol, "markPrice": command.markPrice})
        return {"events": events, **snapshot(session.trading)}
    try:
        return atomic_session(request, apply)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/orders/cancel-all")
def cancel_all(request: Request, reason: str | None = None):
    def cancel_pending(session):
        service = session.trading
        pending = list(service.pending_orders())
        if not pending:
            return {"orders": [], **snapshot(service)}
        cancelled = [service.cancel(order["id"]) for order in pending]
        if reason:
            for order in cancelled:
                order["cancelReason"] = str(reason)
                service.orders[order["id"]]["cancelReason"] = str(reason)
        session.record("cancel_all", session.replay.index, {"reason": str(reason) if reason else None})
        return {"orders": cancelled, **snapshot(service)}
    try:
        return atomic_session(request, cancel_pending)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/orders/{order_id}/cancel")
def cancel(request: Request, order_id: int):
    def cancel_one(session):
        order = session.trading.cancel(order_id)
        session.record("cancel", session.replay.index, {"orderId": order_id})
        return {"order": order, **snapshot(session.trading)}
    try:
        return atomic_session(request, cancel_one)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/risk")
def risk(request: Request, command: RiskRequest):
    try:
        def set_risk(session):
            position = session.trading.set_risk(command.symbol, command.stopLoss, command.takeProfit)
            session.record("risk", session.replay.index, {"symbol": command.symbol, "stopLoss": command.stopLoss, "takeProfit": command.takeProfit})
            return {"position": position, **snapshot(session.trading)}
        return atomic_session(request, set_risk)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/risk/clear")
def clear_risk(request: Request, symbol: str, target: Literal["all", "stopLoss", "takeProfit"] = "all"):
    def clear(session):
        if target == "stopLoss":
            position = session.trading.clear_stop_loss(symbol)
        elif target == "takeProfit":
            position = session.trading.clear_take_profit(symbol)
        else:
            position = session.trading.clear_risk(symbol)
        session.record("clear_risk", session.replay.index, {"symbol": symbol, "target": target})
        return {"position": position, **snapshot(session.trading)}
    try:
        return atomic_session(request, clear)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/candle")
def process(request: Request, command: MarketCandleRequest | None = None):
    command = command or MarketCandleRequest()
    def process_candle(session):
        replay_index = session.replay.state()["index"]
        if replay_index < 0:
            raise HTTPException(409, "Load data and start replay before processing a market candle")
        symbol = _active_symbol(session, command.symbol)
        if command.index is not None and command.index != replay_index:
            raise HTTPException(409, "candle index must match replay index for deterministic history")
        raw = command.candle.model_dump() if command.candle is not None else replay_candle(session, symbol)
        candle = normalize_candle(raw)
        index = replay_index
        existing = session.trading.get_latest_market(symbol)
        is_same_index_retry = existing is not None and existing.get("index") == index
        events = session.trading.on_candle(candle, index, symbol)
        if not is_same_index_retry:
            session.record("candle", replay_index, {"candle": candle, "index": index, "symbol": symbol})
        return {"events": events, "candle": candle, **snapshot(session.trading)}
    try:
        return atomic_session(request, process_candle)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/account/capital")
def set_capital(request: Request, command: CapitalRequest):
    def change_capital(session):
        service = session.trading.set_starting_balance(command.balance)
        session.record("capital", -1, {"balance": command.balance})
        return snapshot(service)
    try:
        return atomic_session(request, change_capital)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/account/fee-rate")
def set_fee_rate(request: Request, command: FeeRateRequest):
    try:
        def change_fee(session):
            result = session.trading.set_fee_rate(command.rate)
            session.record("fee_rate", session.replay.index, {"rate": command.rate})
            return snapshot(result)
        return atomic_session(request, change_fee)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    def reset_engine(session):
        balance = session.trading.account.starting_balance
        fee_rate = session.trading.fee_rate
        margin_rate = session.trading.margin_rate
        maint_margin_rate = session.trading.maint_margin_rate
        session.trading = PaperTradingEngine(starting_balance=balance, fee_rate=fee_rate, margin_rate=margin_rate, maint_margin_rate=maint_margin_rate)
        session.history = []
        return snapshot(session.trading)
    try:
        return atomic_session(request, reset_engine)
    except StateInvariantError as exc:
        raise _internal_http_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc))
