import math

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal

from ..models import Candle
from ..services.paper_engine import PaperTradingEngine
from ..services.session_manager import atomic_session, get_session

router = APIRouter()


class EngineOrder(BaseModel):
    symbol: str = Field(min_length=1)
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0)
    type: Literal["market", "limit", "stop_market"] = "market"
    limitPrice: float | None = Field(default=None, gt=0)
    stopPrice: float | None = Field(default=None, gt=0)


class RiskRequest(BaseModel):
    symbol: str = Field(min_length=1)
    stopLoss: float | None = Field(default=None, gt=0)
    takeProfit: float | None = Field(default=None, gt=0)


class CloseRequest(BaseModel):
    symbol: str = Field(min_length=1)
    quantity: float | None = Field(default=None, gt=0)


class MarketCandleRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT", min_length=1)
    candle: Candle | None = None
    index: int | None = None


class CapitalRequest(BaseModel):
    balance: float = Field(gt=0)


class FeeRateRequest(BaseModel):
    rate: float = Field(ge=0, lt=1)


def snapshot(service: PaperTradingEngine):
    return service.snapshot()


def replay_candle(session, symbol: str):
    candle = session.replay.state().get("candle")
    if not candle:
        raise HTTPException(409, "Load data and start replay before trading")
    return candle


def normalize_candle(raw: dict):
    try:
        candle = {
            "time": int(float(raw.get("time"))),
            "open": float(raw.get("open")),
            "high": float(raw.get("high")),
            "low": float(raw.get("low")),
            "close": float(raw.get("close")),
            "volume": float(raw.get("volume", 0) or 0),
        }
    except (TypeError, ValueError):
        raise HTTPException(422, "candle must contain numeric time/open/high/low/close/volume fields")

    if candle["time"] < 0 or any(not math.isfinite(float(v)) for v in candle.values()):
        raise HTTPException(422, "candle contains non-finite or invalid numeric values")
    if candle["high"] < max(candle["open"], candle["close"]):
        raise HTTPException(422, "candle high is below open/close")
    if candle["low"] > min(candle["open"], candle["close"]):
        raise HTTPException(422, "candle low is above open/close")
    if candle["high"] < candle["low"]:
        raise HTTPException(422, "candle high is below low")
    return candle


@router.get("/state")
def state(request: Request):
    return snapshot(get_session(request).trading)


@router.get("/orders")
def orders(request: Request):
    service = get_session(request).trading
    values = list(service.orders.values())
    return {"orders": values, "pendingOrders": [o for o in values if o["status"] == "PENDING"]}


@router.get("/trades")
def trades(request: Request):
    return {"trades": get_session(request).trading.trades}


@router.post("/order")
def order(request: Request, command: EngineOrder):
    def submit(session):
        service = session.trading
        created = service.submit(
            command.symbol,
            command.side,
            command.quantity,
            command.type,
            command.limitPrice,
            command.stopPrice,
        )
        return {"order": created, **snapshot(service)}

    try:
        return atomic_session(request, submit)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/close")
def close(request: Request, command: CloseRequest):
    def close_position(session):
        candle = replay_candle(session, command.symbol)
        trade = session.trading.close(
            command.symbol,
            float(candle["close"]),
            quantity=command.quantity,
            timestamp=candle.get("time"),
        )
        if not trade:
            raise HTTPException(422, "no open position")
        return {"trade": trade, **snapshot(session.trading)}

    try:
        return atomic_session(request, close_position)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/orders/{order_id}/cancel")
def cancel(request: Request, order_id: int):
    try:
        return atomic_session(
            request,
            lambda session: {"order": session.trading.cancel(order_id), **snapshot(session.trading)},
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/risk")
def risk(request: Request, command: RiskRequest):
    try:
        return atomic_session(
            request,
            lambda session: {
                "position": session.trading.set_risk(command.symbol, command.stopLoss, command.takeProfit),
                **snapshot(session.trading),
            },
        )
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
        return {"position": position, **snapshot(session.trading)}

    try:
        return atomic_session(request, clear)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/candle")
def process(request: Request, command: MarketCandleRequest | None = None):
    command = command or MarketCandleRequest()

    def process_candle(session):
        raw = command.candle.model_dump() if command.candle is not None else replay_candle(session, command.symbol)
        candle = normalize_candle(raw)
        index = command.index if command.index is not None else session.replay.state()["index"]
        events = session.trading.on_candle(candle, index, command.symbol)
        return {"events": events, "candle": candle, **snapshot(session.trading)}

    return atomic_session(request, process_candle)


@router.post("/account/capital")
def set_capital(request: Request, command: CapitalRequest):
    try:
        return atomic_session(request, lambda session: snapshot(session.trading.set_starting_balance(command.balance)))
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/account/fee-rate")
def set_fee_rate(request: Request, command: FeeRateRequest):
    try:
        return atomic_session(request, lambda session: snapshot(session.trading.set_fee_rate(command.rate)))
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    def reset_engine(session):
        balance = session.trading.account.starting_balance
        fee_rate = session.trading.fee_rate
        session.trading = PaperTradingEngine(starting_balance=balance, fee_rate=fee_rate)
        return snapshot(session.trading)

    return atomic_session(request, reset_engine)
