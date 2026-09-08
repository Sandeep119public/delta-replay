from fastapi import APIRouter, HTTPException, Request

from ..models import CandleBatch
from ..services.session_manager import get_session

router = APIRouter()


@router.get("/state")
def state(request: Request):
    return get_session(request).replay.state()


@router.post("/load")
def load(request: Request, batch: CandleBatch):
    session = get_session(request)
    # A dataset load starts a new replay session and must not leave stale
    # trading state attached to the previous dataset.
    if session.trading.has_open_position() or session.trading.orders:
        raise HTTPException(409, "Close positions and cancel orders before loading new data")
    return session.replay.load([c.model_dump() for c in batch.candles])


@router.post("/start/{index}")
def start(request: Request, index: int):
    try:
        return get_session(request).replay.start(index)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/step")
def step(request: Request):
    return get_session(request).replay.step()


@router.post("/seek/{index}")
def seek(request: Request, index: int):
    try:
        return get_session(request).replay.seek(index)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    return get_session(request).replay.reset()
