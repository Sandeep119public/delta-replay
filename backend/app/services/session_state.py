from copy import deepcopy
from typing import Any, Dict

from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService


SESSION_STATE_VERSION = 1


def serialize_session(replay: ReplayService, trading: PaperTradingEngine) -> Dict[str, Any]:
    """Return the canonical, JSON-compatible session persistence document."""
    return {
        "version": SESSION_STATE_VERSION,
        "replay": replay.export_state(),
        "trading": trading.export_state(),
    }


def restore_session(document: Dict[str, Any]) -> tuple[ReplayService, PaperTradingEngine]:
    """Rehydrate services from a validated persistence document."""
    if not isinstance(document, dict):
        raise ValueError("session document must be an object")
    if document.get("version") != SESSION_STATE_VERSION:
        raise ValueError("unsupported session state version")

    replay = ReplayService.from_state(document.get("replay"))
    trading = PaperTradingEngine.from_state(document.get("trading"))
    return replay, trading


def clone_session_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """Make defensive copies at the repository boundary."""
    return deepcopy(document)
