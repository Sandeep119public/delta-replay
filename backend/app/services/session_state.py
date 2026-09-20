from copy import deepcopy
import json
from math import isfinite
from typing import Any, Dict

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .replay_timeline import ReplayDivergenceError, validate_history


SESSION_STATE_VERSION = 2
SUPPORTED_SESSION_STATE_VERSIONS = {1, SESSION_STATE_VERSION}

def _validate_json_safety(document: Dict[str, Any]) -> None:
    try:
        json.dumps(document, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"session document is not JSON-safe: {exc}") from exc


def _validate_history(history, *, replay_index=None) -> None:
    try:
        validate_history(history, replay_index_limit=replay_index)
    except ReplayDivergenceError as exc:
        raise ValueError(str(exc)) from exc


def _validate_market_state(replay: ReplayService, trading: PaperTradingEngine, market_state: dict) -> None:
    if not isinstance(market_state, dict):
        raise ValueError("trading market state must be an object")

    if trading.index > replay.index:
        raise ValueError("trading index cannot be ahead of replay index")

    for symbol, market in market_state.items():
        if not isinstance(symbol, str) or symbol != symbol.strip().upper() or not symbol.strip():
            raise ValueError("invalid market symbol")
        if not isinstance(market, dict):
            raise ValueError("invalid market context")
        index = market.get("index")
        if isinstance(index, bool) or not isinstance(index, int) or index < 0 or index > trading.index:
            raise ValueError(f"market index for {symbol} is outside trading timeline")
        candle = market.get("candle")
        if not isinstance(candle, dict):
            raise ValueError(f"market candle for {symbol} is invalid")
        for field in ("open", "high", "low", "close"):
            value = candle.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
                raise ValueError(f"market candle {field} for {symbol} is invalid")
        if candle["high"] < max(candle["open"], candle["close"]) or candle["low"] > min(candle["open"], candle["close"]):
            raise ValueError(f"market candle range for {symbol} is invalid")
        if index >= len(replay.candles):
            raise ValueError(f"market index for {symbol} is outside replay dataset")

    missing_position_markets = sorted(set(trading.positions) - set(market_state))
    if missing_position_markets:
        raise ValueError(
            "open positions require market context: " + ", ".join(missing_position_markets)
        )
    for symbol, position in trading.positions.items():
        market_index = market_state[symbol]["index"]
        opened_index = position["opened_index"]
        if market_index < opened_index:
            raise ValueError(f"market context for {symbol} predates its open position")


def serialize_session(
    replay: ReplayService,
    trading: PaperTradingEngine,
    history: list[dict] | None = None,
) -> Dict[str, Any]:
    """Return the canonical JSON-compatible session persistence document."""
    history = deepcopy(history or [])
    _validate_history(history, replay_index=replay.index)
    document = {
        "version": SESSION_STATE_VERSION,
        "replay": replay.export_state(),
        "trading": trading.export_state(),
        "tradingMarket": trading.export_market_state(),
        "history": history,
    }
    _validate_market_state(replay, trading, document["tradingMarket"])
    _validate_json_safety(document)
    return document


def restore_session_bundle(document: Dict[str, Any]):
    """Restore replay, trading, and command history in one validation pass."""
    if not isinstance(document, dict):
        raise ValueError("session document must be an object")
    version = document.get("version")
    if version not in SUPPORTED_SESSION_STATE_VERSIONS:
        raise ValueError("unsupported session state version")
    _validate_json_safety(document)

    try:
        replay = ReplayService.from_state(document.get("replay"))
        trading = PaperTradingEngine.from_state(document.get("trading"))
        market_state = document.get("tradingMarket", {})
        _validate_market_state(replay, trading, market_state)
        trading.restore_market_state(market_state)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc

    history = [] if version == 1 else deepcopy(document.get("history", []))
    _validate_history(history, replay_index=replay.index)
    return replay, trading, history


def restore_session(document: Dict[str, Any]):
    """Rehydrate replay and trading services using the legacy two-value contract."""
    return restore_session_bundle(document)[:2]


def extract_history(document: Dict[str, Any]) -> list[dict]:
    """Return validated deterministic user commands from a persisted session."""
    try:
        _, _, history = restore_session_bundle(document)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session history: {exc}") from exc
    return history


def clone_session_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """Make defensive copies at the repository boundary."""
    return deepcopy(document)
