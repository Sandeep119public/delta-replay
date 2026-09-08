from fastapi import APIRouter, HTTPException, Request

from ..models import CandleBatch
from ..services.paper_engine import PaperTradingEngine
from ..services.session_manager import atomic_session, get_session, persist_session

router = APIRouter()


@router.get("/state")
def state(request: Request):
    return get_session(request).replay.state()


@router.post("/load")
def load(request: Request, batch: CandleBatch):
    session = get_session(request)
    if session.trading.has_open_position() or session.trading.pending_orders():
        raise HTTPException(409, "Close positions and cancel pending orders before loading new data")

    balance = session.trading.account.starting_balance
    fee_rate = session.trading.fee_rate
    session.trading = PaperTradingEngine(starting_balance=balance, fee_rate=fee_rate)
    result = session.replay.load([c.model_dump() for c in batch.candles])
    persist_session(request, session)
    return result


@router.post("/start/{index}")
def start(request: Request, index: int):
    session = get_session(request)
    try:
        result = session.replay.start(index)
        persist_session(request, session)
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/step")
def step(request: Request):
    def advance(session):
        previous_index = session.replay.index
        result = session.replay.step()
        if result["index"] == previous_index or result["index"] < 0:
            return {**result, "events": [], "trading": session.trading.snapshot()}

        candle = result["candle"]
        events = session.trading.on_candle(candle, result["index"], "BTCUSDT")
        return {**result, "events": events, "trading": session.trading.snapshot()}

    try:
        return atomic_session(request, advance)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/seek/{index}")
def seek(request: Request, index: int):
    session = get_session(request)
    if session.trading.has_open_position() or session.trading.pending_orders():
        raise HTTPException(409, "Close positions and cancel pending orders before seeking")
    try:
        result = session.replay.seek(index)
        persist_session(request, session)
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    session = get_session(request)
    result = session.replay.reset()
    persist_session(request, session)
    return result
