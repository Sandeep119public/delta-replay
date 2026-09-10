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
        "tradingMarket": deepcopy(trading._market_by_symbol),
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
            close = candle.get("close")
            trading._positive_finite(close, "market close")
            market_index = trading._integer(value.get("index"), "market index")
            if market_index < -1 or market_index > trading.index:
                raise ValueError("market index is outside trading timeline")
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session state: {exc}") from exc
    return replay, trading


def clone_session_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """Make defensive copies at the repository boundary."""
    return deepcopy(document)
