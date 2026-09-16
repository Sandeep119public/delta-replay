from copy import deepcopy
import json
from math import isfinite
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
MARKET_EVENT_TYPES = {"market_step", "candle"}


def _validate_json_safety(document: Dict[str, Any]) -> None:
    try:
        json.dumps(document, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"session document is not JSON-safe: {exc}") from exc


def _validate_history(history, *, replay_index=None) -> None:
    if not isinstance(history, list):
        raise ValueError("session history must be a list")
    last_replay_index = -1
    market_context_keys = set()
    market_step_indexes = set()
    first_type_by_index = {}
    non_market_seen_by_index = set()
    for item in history:
        if not isinstance(item, dict):
            raise ValueError("session history entries must be objects")
        event_type = item.get("type")
        if not isinstance(event_type, str) or event_type not in VALID_HISTORY_TYPES:
            raise ValueError("unsupported session history event type")
        index = item.get("replayIndex")
        if isinstance(index, bool) or not isinstance(index, int) or index < -1:
            raise ValueError("session history replayIndex is invalid")
        if index < last_replay_index:
            raise ValueError("session history must be ordered by replayIndex")
        if replay_index is not None and index > replay_index:
            raise ValueError("session history contains an event beyond replay index")
        payload = item.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("session history payload must be an object")
        if index not in first_type_by_index:
            first_type_by_index[index] = event_type
        if event_type in MARKET_EVENT_TYPES:
            if index < 0:
                raise ValueError(f"{event_type} cannot use replayIndex -1")
            if index in non_market_seen_by_index:
                raise ValueError(f"market context at replay index {index} must precede trading commands")
            symbol = payload.get("symbol")
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper():
                raise ValueError(f"{event_type} symbol is invalid")
            if event_type == "market_step":
                if index in market_step_indexes:
                    raise ValueError(f"multiple market events exist for replay index {index}")
                market_step_indexes.add(index)
                if first_type_by_index[index] != "market_step":
                    raise ValueError(f"market_step at replay index {index} must be first")
            else:
                candle_index = payload.get("index")
                if isinstance(candle_index, bool) or not isinstance(candle_index, int) or candle_index != index:
                    raise ValueError("candle index must match replayIndex")
                key = (index, symbol)
                if key in market_context_keys:
                    raise ValueError(f"multiple market context events exist for {symbol} at replay index {index}")
                market_context_keys.add(key)
                if first_type_by_index[index] not in MARKET_EVENT_TYPES:
                    raise ValueError(f"market context at replay index {index} must follow the timeline event")
        else:
            non_market_seen_by_index.add(index)
        last_replay_index = index


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
