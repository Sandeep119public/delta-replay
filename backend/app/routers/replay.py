from fastapi import APIRouter, HTTPException, Request

from ..models import CandleBatch
from ..domain.execution import EXECUTION_MODEL
from ..services.replay_timeline import ReplayDivergenceError
from ..services.session_manager import atomic_session, get_session
from ..services.github_dataset_repository import GitHubDatasetRepository

router = APIRouter()
dataset_repository = GitHubDatasetRepository()


def trading_api_snapshot(engine):
    state = engine.snapshot()
    orders = list(state["orders"].values())
    return {
        **state,
        "positions": list(state["positions"].values()),
        "orders": orders,
        "pendingOrders": [order for order in orders if order["status"] == "PENDING"],
    }


def _replay_symbol(session, fallback="BTCUSDT"):
    try:
        return session.timeline.latest_market_context_symbol()
    except ReplayDivergenceError:
        return fallback


def _active_replay_symbol(session, requested_symbol=None):
    if requested_symbol is not None:
        symbol = str(requested_symbol).strip().upper()
        if not symbol:
            raise HTTPException(422, "symbol must be provided")
        return symbol
    try:
        return session.timeline.latest_market_context_symbol()
    except ReplayDivergenceError as exc:
        raise HTTPException(409, "Start the replay before advancing or seeking it") from exc


@router.get("/state")
def state(request: Request):
    return {**get_session(request).replay.state(), "executionModel": EXECUTION_MODEL}


@router.post("/load-dataset/{dataset_id}")
def load_dataset(request: Request, dataset_id: str):
    try:
        dataset = dataset_repository.get(dataset_id)
    except Exception as exc:
        raise HTTPException(502, f"Unable to load replay dataset: {exc}") from exc
    if dataset is None:
        raise HTTPException(404, "Dataset not found")

    def replace(session):
        result = session.load(dataset["candles"])
        result["datasetId"] = dataset["metadata"]["id"]
        result["datasetMetadata"] = dataset["metadata"]
        return replay_snapshot(session, result)

    return atomic_session(request, replace)


@router.post("/load")
def load(request: Request, batch: CandleBatch):
    def replace(session):
        return replay_snapshot(session, session.load([c.model_dump() for c in batch.candles]))
    return atomic_session(request, replace)


@router.post("/start/{index}")
def start(request: Request, index: int, symbol: str = "BTCUSDT"):
    symbol = str(symbol).strip().upper()
    if not symbol:
        raise HTTPException(422, "symbol must be provided")
    try:
        return atomic_session(request, lambda session: replay_snapshot(session, session.start(index, symbol)))
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/step")
def step(request: Request, symbol: str | None = None):
    def advance(session):
        active_symbol = _active_replay_symbol(session, symbol)
        result, events = session.step(active_symbol)
        return {**result, "events": events, "trading": trading_api_snapshot(session.trading)}
    try:
        return atomic_session(request, advance)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/seek/{index}")
def seek(request: Request, index: int, symbol: str | None = None):
    def reposition(session):
        active_symbol = _active_replay_symbol(session, symbol)
        try:
            result = session.seek(index, active_symbol)
        except ReplayDivergenceError as exc:
            raise HTTPException(409, f"Unable to deterministically replay this position: {exc}") from exc
        return replay_snapshot(session, result)
    try:
        return atomic_session(request, reposition)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    def reset_session(session):
        symbol = _replay_symbol(session)
        replay = session.reset_replay(symbol)
        return {**replay, "trading": trading_api_snapshot(session.trading)}
    try:
        return atomic_session(request, reset_session)
    except (ValueError, ReplayDivergenceError) as exc:
        raise HTTPException(409, str(exc))


def replay_snapshot(session, replay_state):
    return {**replay_state, "executionModel": EXECUTION_MODEL, "trading": trading_api_snapshot(session.trading)}
