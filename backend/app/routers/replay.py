from fastapi import APIRouter, HTTPException, Request

from ..models import CandleBatch
from ..services.paper_engine import PaperTradingEngine
from ..services.replay_timeline import ReplayDivergenceError, rebuild_trading
from ..services.session_manager import atomic_session, get_session

router = APIRouter()


def trading_api_snapshot(engine):
    state = engine.snapshot()
    orders = list(state["orders"].values())
    return {
        **state,
        "positions": list(state["positions"].values()),
        "orders": orders,
        "pendingOrders": [order for order in orders if order["status"] == "PENDING"],
    }


def require_pristine_trading(session, action, *, allow_replay_progress=False):
    trading = session.trading
    if trading.has_open_position() or trading.pending_orders():
        raise HTTPException(409, f"Close positions and cancel pending orders before {action}")
    if trading.trades or trading.orders or trading.funding or (trading.index >= 0 and not allow_replay_progress):
        raise HTTPException(409, f"Reset the simulation before {action} after trading activity")


def _replay_symbol(session, fallback="BTCUSDT"):
    for command in reversed(session.history):
        if command.get("type") not in {"market_step", "candle"}:
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()
    return fallback


def _active_replay_symbol(session, requested_symbol=None):
    if requested_symbol is not None:
        requested = str(requested_symbol).strip().upper()
        if not requested:
            raise HTTPException(422, "symbol must be provided")
        return requested

    for command in reversed(session.history):
        if command.get("type") not in {"market_step", "candle"}:
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()

    raise HTTPException(409, "Start the replay before advancing or seeking it")


@router.get("/state")
def state(request: Request):
    return get_session(request).replay.state()


@router.post("/load")
def load(request: Request, batch: CandleBatch):
    candles = [c.model_dump() for c in batch.candles]

    def replace(session):
        require_pristine_trading(session, "loading new data", allow_replay_progress=True)
        trading = session.trading
        session.replay.load(candles)
        session.trading = PaperTradingEngine(
            starting_balance=trading.account.starting_balance,
            fee_rate=trading.fee_rate,
            margin_rate=trading.margin_rate,
            maint_margin_rate=trading.maint_margin_rate,
        )
        session.history = []
        return replay_snapshot(session)

    return atomic_session(request, replace)


@router.post("/start/{index}")
def start(request: Request, index: int, symbol: str = "BTCUSDT"):
    symbol = str(symbol).strip().upper()
    if not symbol:
        raise HTTPException(422, "symbol must be provided")

    def position(session):
        require_pristine_trading(session, "starting replay")
        result = session.replay.start(index)
        if result["index"] < 0:
            return replay_snapshot(session)
        session.trading.on_candle(result["candle"], result["index"], symbol)
        session.record("market_step", result["index"], {"symbol": symbol})
        return replay_snapshot(session)

    try:
        return atomic_session(request, position)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/step")
def step(request: Request, symbol: str | None = None):
    def advance(session):
        active_symbol = _active_replay_symbol(session, symbol)
        previous_index = session.replay.index
        result = session.replay.step()
        if result["index"] == previous_index or result["index"] < 0:
            return {**result, "events": [], "trading": trading_api_snapshot(session.trading)}

        candle = result["candle"]
        events = session.trading.on_candle(candle, result["index"], active_symbol)
        session.record("market_step", result["index"], {"symbol": active_symbol})
        return {**result, "events": events, "trading": trading_api_snapshot(session.trading)}

    try:
        return atomic_session(request, advance)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.post("/seek/{index}")
def seek(request: Request, index: int, symbol: str | None = None):
    def reposition(session):
        active_symbol = _active_replay_symbol(session, symbol)
        result = session.replay.seek(index)
        filtered_history = [item for item in session.history if item.get("replayIndex", -1) <= result["index"]]
        trading = session.trading
        try:
            session.trading = rebuild_trading(
                session.replay,
                filtered_history,
                result["index"],
                default_symbol=active_symbol,
                starting_balance=trading.account.starting_balance,
                fee_rate=trading.fee_rate,
                margin_rate=trading.margin_rate,
                maint_margin_rate=trading.maint_margin_rate,
            )
        except ReplayDivergenceError as exc:
            raise HTTPException(409, f"Unable to deterministically replay this position: {exc}") from exc
        session.history = filtered_history
        return replay_snapshot(session)

    try:
        return atomic_session(request, reposition)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/reset")
def reset(request: Request):
    def reset_session(session):
        trading = session.trading
        balance = trading.account.starting_balance
        fee_rate = trading.fee_rate
        margin_rate = trading.margin_rate
        maint_margin_rate = trading.maint_margin_rate
        symbol = _replay_symbol(session)
        session.trading = PaperTradingEngine(
            starting_balance=balance,
            fee_rate=fee_rate,
            margin_rate=margin_rate,
            maint_margin_rate=maint_margin_rate,
        )
        session.history = []
        replay = session.replay.reset()
        if replay["index"] >= 0:
            session.trading.on_candle(replay["candle"], replay["index"], symbol)
            session.record("market_step", replay["index"], {"symbol": symbol})
        return {**replay, "trading": trading_api_snapshot(session.trading)}

    return atomic_session(request, reset_session)


def replay_snapshot(session):
    return {**session.replay.state(), "trading": trading_api_snapshot(session.trading)}
