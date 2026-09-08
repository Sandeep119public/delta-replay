from copy import deepcopy
import json
from typing import Any, Dict

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService


SESSION_STATE_VERSION = 1


def _validate_json_safety(document: Dict[str, Any]) -> None:
    try:
        json.dumps(document, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"session document is not JSON-safe: {exc}") from exc


def serialize_session(replay: ReplayService, trading: PaperTradingEngine) -> Dict[str, Any]:
    """Return the canonical, JSON-compatible session persistence document."""
    document = {
        "version": SESSION_STATE_VERSION,
        "replay": replay.export_state(),
        "trading": trading.export_state(),
    }
    _validate_json_safety(document)
    return document


def restore_session(document: Dict[str, Any]) -> tuple[ReplayService, PaperTradingEngine]:
    """Rehydrate services from a validated persistence document."""
    if not isinstance(document, dict):
        raise ValueError("session document must be an object")
    if document.get("version") != SESSION_STATE_VERSION:
        raise ValueError("unsupported session state version")
    _validate_json_safety(document)

    try:
        replay = ReplayService.from_state(document.get("replay"))
        trading = PaperTradingEngine.from_state(document.get("trading"))
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc
    return replay, trading


def clone_session_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """Make defensive copies at the repository boundary."""
    return deepcopy(document)
