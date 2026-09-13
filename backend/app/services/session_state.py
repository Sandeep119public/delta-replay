from copy import deepcopy
import json
from typing import Any, Dict

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService


SESSION_STATE_VERSION = 2
SUPPORTED_SESSION_STATE_VERSIONS = {1, SESSION_STATE_VERSION}
VALID_HISTORY_TYPES = {
    "order",
    "close",
    "cancel",
    "cancel_all",
    "risk",
    "clear_risk",
    "funding",
    "market_step",
    "candle",
    "capital",
    "fee_rate",
}


def _validate_json_safety(document: Dict[str, Any]) -> None:
    try:
        json.dumps(document, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"session document is not JSON-safe: {exc}") from exc


def _validate_history(history) -> None:
    if not isinstance(history, list):
        raise ValueError("session history must be a list")
    last_replay_index = -1
    market_indexes = set()
    for item in history:
        if not isinstance(item, dict):
            raise ValueError("session history entries must be objects")
        event_type = item.get("type")
        if not isinstance(event_type, str) or event_type not in VALID_HISTORY_TYPES:
            raise ValueError("unsupported session history event type")
        replay_index = item.get("replayIndex")
        if isinstance(replay_index, bool) or not isinstance(replay_index, int) or replay_index < -1:
            raise ValueError("session history replayIndex is invalid")
        if replay_index < last_replay_index:
            raise ValueError("session history must be ordered by replayIndex")
        payload = item.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("session history payload must be an object")
        if event_type == "market_step":
            if replay_index < 0:
                raise ValueError("market_step cannot use replayIndex -1")
            if replay_index in market_indexes:
                raise ValueError(f"multiple market_step events exist for replay index {replay_index}")
            symbol = payload.get("symbol")
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper():
                raise ValueError("market_step symbol is invalid")
            market_indexes.add(replay_index)
        last_replay_index = replay_index


def _validate_market_state(trading: PaperTradingEngine, market_state: dict) -> None:
    if not isinstance(market_state, dict):
        raise ValueError("trading market state must be an object")
    for symbol, market in market_state.items():
        if not isinstance(symbol, str) or symbol != symbol.strip().upper() or not symbol.strip():
            raise ValueError("invalid market symbol")
        if not isinstance(market, dict):
            raise ValueError("invalid market context")
        index = market.get("index")
        if isinstance(index, bool) or not isinstance(index, int) or index < -1 or index > trading.index:
            raise ValueError(f"market index for {symbol} is outside trading timeline")


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
        "tradingMarket": trading.export_market_state(),
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
        market_state = document.get("tradingMarket", {})
        _validate_market_state(trading, market_state)
        trading.restore_market_state(market_state)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc

    history = [] if version == 1 else deepcopy(document.get("history", []))
    _validate_history(history)
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
