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
        trading.restore_market_state(document.get("tradingMarket", {}))
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
