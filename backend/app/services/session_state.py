from copy import deepcopy
import hashlib
import json
from math import isfinite
from typing import Any, Dict

from ..domain.execution import EXECUTION_MODEL
from .paper_engine import PaperTradingEngine
from .replay_service import ReplayService
from .replay_session import ReplaySession
from .replay_timeline import ReplayDivergenceError, ReplayTimeline, validate_history


SESSION_STATE_VERSION = 3
ENGINE_VERSION = "replay-engine-v3"
SUPPORTED_SESSION_STATE_VERSIONS = {1, 2, SESSION_STATE_VERSION}


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
    browser_owned = not replay.candles
    if not browser_owned and trading.index > replay.index:
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
        if not browser_owned and index >= len(replay.candles):
            raise ValueError(f"market index for {symbol} is outside replay dataset")
    missing_position_markets = sorted(set(trading.positions) - set(market_state))
    if missing_position_markets:
        raise ValueError("open positions require market context: " + ", ".join(missing_position_markets))
    for symbol, position in trading.positions.items():
        if market_state[symbol]["index"] < position["opened_index"]:
            raise ValueError(f"market context for {symbol} predates its open position")


def _simulation_config(trading: PaperTradingEngine) -> Dict[str, Any]:
    return {
        "engineVersion": ENGINE_VERSION,
        "executionModel": EXECUTION_MODEL,
        "feeRate": trading.fee_rate,
        "marginRate": trading.margin_rate,
        "maintenanceMarginRate": trading.maint_margin_rate,
    }


def simulation_id(document: Dict[str, Any]) -> str:
    identity = {
        "datasetId": document.get("replay", {}).get("datasetId"),
        "simulation": document.get("simulation", {}),
        "history": document.get("history", []),
    }
    encoded = json.dumps(identity, allow_nan=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _serialize_components(replay: ReplayService, trading: PaperTradingEngine, history: list[dict] | None = None) -> Dict[str, Any]:
    history = deepcopy(history or [])
    history_limit = replay.index if replay.candles else trading.index
    _validate_history(history, replay_index=history_limit)
    document = {
        "version": SESSION_STATE_VERSION,
        "replay": replay.export_state(),
        "trading": trading.export_state(),
        "tradingMarket": trading.export_market_state(),
        "simulation": _simulation_config(trading),
        "history": history,
    }
    document["simulationId"] = simulation_id(document)
    _validate_market_state(replay, trading, document["tradingMarket"])
    _validate_json_safety(document)
    return document


def serialize_replay_session(session: ReplaySession) -> Dict[str, Any]:
    if not isinstance(session, ReplaySession):
        raise TypeError("session must be a ReplaySession")
    return _serialize_components(session.replay, session.trading, session.history)




def restore_session_bundle(document: Dict[str, Any]):
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
    history_limit = replay.index if replay.candles else trading.index
    _validate_history(history, replay_index=history_limit)
    if version >= 3:
        simulation = document.get("simulation")
        if not isinstance(simulation, dict):
            raise ValueError("simulation configuration is required")
        if simulation.get("engineVersion") != ENGINE_VERSION or simulation.get("executionModel") != EXECUTION_MODEL:
            raise ValueError("unsupported simulation configuration")
        expected = simulation_id({**document, "history": history})
        if document.get("simulationId") != expected:
            raise ValueError("simulation identity does not match session state")
    return replay, trading, history


def restore_replay_session(document: Dict[str, Any]) -> ReplaySession:
    replay, trading, history = restore_session_bundle(document)
    return ReplaySession(replay=replay, trading=trading, _timeline=ReplayTimeline(history))




def extract_history(document: Dict[str, Any]) -> list[dict]:
    try:
        _, _, history = restore_session_bundle(document)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"invalid session history: {exc}") from exc
    return history


def clone_session_document(document: Dict[str, Any]) -> Dict[str, Any]:
    return deepcopy(document)
