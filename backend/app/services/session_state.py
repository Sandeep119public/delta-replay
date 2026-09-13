from copy import deepcopy
import json
from typing import Any, Dict

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService


SESSION_STATE_VERSION = 2
SUPPORTED_SESSION_STATE_VERSIONS = {1, SESSION_STATE_VERSION}


def _validate_json_safety(document: Dict[str, Any]) -> None:
    try:
        json.dumps(document, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"session document is not JSON-safe: {exc}") from exc


def _validate_history(history) -> None:
    if not isinstance(history, list):
        raise ValueError("session history must be a list")
    for item in history:
        if not isinstance(item, dict):
            raise ValueError("session history entries must be objects")
        if not isinstance(item.get("type"), str) or not item["type"]:
            raise ValueError("session history entry type is required")
        replay_index = item.get("replayIndex")
        if isinstance(replay_index, bool) or not isinstance(replay_index, int) or replay_index < -1:
            raise ValueError("session history replayIndex is invalid")
        if not isinstance(item.get("payload", {}), dict):
            raise ValueError("session history payload must be an object")


def serialize_session(
    replay: ReplayService,
    trading: PaperTradingEngine,
    history: list[dict] | None = None,
) -> Dict[str, Any]:
    """Return the canonical JSON-compatible session persistence document."""
    history = deepcopy(history or [])
    _validate_history(history)
    document = {
        "version": SESSION_STATE_VERSION,
        "replay": replay.export_state(),
        "trading": trading.export_state(),
        "tradingMarket": deepcopy(trading._market_by_symbol),
        "history": history,
    }
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
        market = document.get("tradingMarket", {})
        if not isinstance(market, dict):
            raise ValueError("tradingMarket must be an object")
        trading._market_by_symbol = deepcopy(market)
        for symbol, value in trading._market_by_symbol.items():
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper():
                raise ValueError("invalid trading market symbol")
            if not isinstance(value, dict):
                raise ValueError("invalid trading market context")
            candle = value.get("candle")
            if not isinstance(candle, dict):
                raise ValueError("invalid trading market candle")
            trading._positive_finite(candle.get("close"), "market close")
            market_index = trading._integer(value.get("index"), "market index")
            if market_index < -1 or market_index > trading.index:
                raise ValueError("market index is outside trading timeline")
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc

    history = [] if version == 1 else deepcopy(document.get("history", []))
    _validate_history(history)
    return replay, trading, history


def restore_session(document: Dict[str, Any]):
    """Rehydrate replay and trading services using the legacy two-value contract."""
    try:
        replay, trading, _ = restore_session_bundle(document)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc
    return replay, trading


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
