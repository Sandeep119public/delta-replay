from fastapi import APIRouter, HTTPException, Request

from ..models import CandleBatch
from ..services.paper_engine import PaperTradingEngine
from ..services.session_manager import atomic_session, get_session

router = APIRouter()


@router.get("/state")
def state(request: Request):
    return get_session(request).replay.state()


@router.post("/load")
def load(request: Request, batch: CandleBatch):
    candles = [c.model_dump() for c in batch.candles]

    def replace(session):
        trading = session.trading
        if trading.has_open_position() or trading.pending_orders():
            raise HTTPException(409, "Close positions and cancel pending orders before loading new data")
        balance = trading.account.starting_balance
        fee_rate = trading.fee_rate
        margin_rate = trading.margin_rate
        maintenance_margin_rate = trading.maint_margin_rate
        session.trading = PaperTradingEngine(
            starting_balance=balance,
            fee_rate=fee_rate,
            margin_rate=margin_rate,
            maint_margin_rate=maintenance_margin_rate,
        )
        return session.replay.load(candles)

    return atomic_session(request, replace)


@router.post("/start/{index}")
def start(request: Request, index: int):
    try:
        return atomic_session(request, lambda session: session.replay.start(index))
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
    def reposition(session):
        if session.trading.has_open_position() or session.trading.pending_orders():
            raise HTTPException(409, "Close positions and cancel pending orders before seeking")
        return session.replay.seek(index)

    try:
        return atomic_session(request, reposition)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    return atomic_session(request, lambda session: session.replay.reset())
