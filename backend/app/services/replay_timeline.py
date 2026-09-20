"""Deterministic reconstruction of trading state from the persisted event timeline."""

from copy import deepcopy

from .paper_engine import PaperTradingEngine


MARKET_EVENT_TYPES = {"market_step", "candle"}
VALID_HISTORY_TYPES = {"order", "close", "cancel", "cancel_all", "risk", "clear_risk", "funding", "market_step", "candle", "capital", "fee_rate"}


def latest_market_step_symbol(history):
    """Return the symbol from the most recent canonical replay market step."""
    for command in reversed(list(history or [])):
        if command.get("type") != "market_step":
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()
    raise ReplayDivergenceError("replay history has no canonical market symbol")


def latest_market_event_symbol(history):
    """Return the symbol from the most recent canonical market event (step or candle)."""
    for command in reversed(list(history or [])):
        if command.get("type") not in MARKET_EVENT_TYPES:
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()
    raise ReplayDivergenceError("replay history has no canonical market symbol")


class ReplayDivergenceError(ValueError):
    """Raised when persisted commands cannot reproduce the trading state."""

class ReplayTimeline:
    """Canonical ordered event history for a replay session."""

    def __init__(self, events=None):
        self._events = [deepcopy(event) for event in (events or [])]
        validate_history(self._events)

    def snapshot(self):
        return deepcopy(self._events)

    def latest_market_step_symbol(self) -> str:
        """Return the most recent canonical replay market-step symbol."""
        for command in reversed(self._events):
            if command.get("type") != "market_step":
                continue
            symbol = command.get("payload", {}).get("symbol")
            if isinstance(symbol, str) and symbol.strip():
                return symbol.strip().upper()
        raise ReplayDivergenceError("replay history has no canonical market symbol")

    def latest_market_event_symbol(self) -> str:
        """Return the most recent canonical market-event symbol."""
        for command in reversed(self._events):
            if command.get("type") not in MARKET_EVENT_TYPES:
                continue
            symbol = command.get("payload", {}).get("symbol")
            if isinstance(symbol, str) and symbol.strip():
                return symbol.strip().upper()
        raise ReplayDivergenceError("replay history has no canonical market symbol")

    def replace(self, events):
        candidate = [deepcopy(event) for event in (events or [])]
        validate_history(candidate)
        self._events = candidate

    def truncate_after(self, replay_index):
        self._events = [
            event for event in self._events
            if event.get("replayIndex", -1) <= replay_index
        ]

    def record(self, command_type, replay_index, payload):
        candidate = self.snapshot()
        candidate = [
            event for event in candidate
            if event.get("replayIndex", -1) <= replay_index
        ]
        candidate.append({
            "type": command_type,
            "replayIndex": int(replay_index),
            "payload": deepcopy(payload),
        })
        validate_history(candidate)
        self._events = candidate

    def __iter__(self):
        return iter(self._events)

    def __len__(self):
        return len(self._events)


def _apply_command(engine: PaperTradingEngine, command: dict, replay=None) -> None:
    kind = command["type"]
    payload = command["payload"]

    try:
        if kind == "order":
            engine.submit(payload["symbol"], payload["side"], payload["quantity"], payload.get("type", "market"), payload.get("limitPrice"), payload.get("stopPrice"), created_index=command["replayIndex"])
        elif kind == "close":
            engine.close(payload["symbol"], payload["price"], reason="MARKET", timestamp=payload.get("timestamp"), quantity=payload.get("quantity"))
        elif kind == "cancel":
            engine.cancel(payload["orderId"])
        elif kind == "cancel_all":
            for pending in list(engine.pending_orders()):
                cancelled = engine.cancel(pending["id"])
                if payload.get("reason"):
                    reason = str(payload["reason"])
                    cancelled["cancelReason"] = reason
                    engine.orders[pending["id"]]["cancelReason"] = reason
        elif kind == "risk":
            engine.set_risk(payload["symbol"], payload.get("stopLoss"), payload.get("takeProfit"))
        elif kind == "clear_risk":
            target = payload.get("target", "all")
            if target == "stopLoss":
                engine.clear_stop_loss(payload["symbol"])
            elif target == "takeProfit":
                engine.clear_take_profit(payload["symbol"])
            else:
                engine.clear_risk(payload["symbol"])
        elif kind == "funding":
            engine.apply_funding(payload["rate"], timestamp=payload.get("timestamp"), symbol=payload.get("symbol"), mark_price=payload.get("markPrice"))
        elif kind == "market_step":
            if replay is None:
                raise ReplayDivergenceError("market_step requires replay data")
            index = int(command["replayIndex"])
            if index < 0 or index >= len(replay.candles):
                raise ReplayDivergenceError("market_step replay index is outside dataset")
            if engine.index == -1:
                engine.on_candle(replay.candles[index], index, payload["symbol"])
                return
            if index != engine.index + 1:
                raise ReplayDivergenceError(f"market_step index {index} is not the next executable index {engine.index + 1}")
            engine.on_candle(replay.candles[index], index, payload["symbol"])
        elif kind == "candle":
            engine.on_candle(payload["candle"], payload["index"], payload["symbol"])
        elif kind == "capital":
            engine.set_starting_balance(payload["balance"])
        elif kind == "fee_rate":
            engine.set_fee_rate(payload["rate"])
        else:
            raise ReplayDivergenceError(f"unsupported replay command: {kind}")
    except ReplayDivergenceError:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise ReplayDivergenceError(f"replay command {kind} diverged: {exc}") from exc


def validate_history(history, *, replay_index_limit=None) -> None:
    """Validate persisted command history and canonical market-event ordering."""
    if not isinstance(history, list):
        raise ReplayDivergenceError("session history must be a list")

    last_replay_index = -1
    market_context_keys = set()
    market_step_indexes = set()
    first_type_by_index = {}
    non_market_seen_by_index = set()

    for command in history:
        if not isinstance(command, dict):
            raise ReplayDivergenceError("session history entries must be objects")
        event_type = command.get("type")
        if not isinstance(event_type, str) or event_type not in VALID_HISTORY_TYPES:
            raise ReplayDivergenceError("unsupported session history event type")
        index = command.get("replayIndex")
        if isinstance(index, bool) or not isinstance(index, int) or index < -1:
            raise ReplayDivergenceError("session history replayIndex is invalid")
        if index < last_replay_index:
            raise ReplayDivergenceError("session history is not ordered by replayIndex")
        if replay_index_limit is not None and index > replay_index_limit:
            raise ReplayDivergenceError("session history contains an event beyond replay index")
        payload = command.get("payload")
        if not isinstance(payload, dict):
            raise ReplayDivergenceError("session history payload must be an object")
        if index not in first_type_by_index:
            first_type_by_index[index] = event_type

        if event_type in MARKET_EVENT_TYPES:
            if index < 0:
                raise ReplayDivergenceError(f"{event_type} cannot use replayIndex -1")
            if index in non_market_seen_by_index:
                raise ReplayDivergenceError(f"market context at replay index {index} must precede trading commands")
            symbol = payload.get("symbol")
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper():
                raise ReplayDivergenceError(f"{event_type} symbol is invalid")
            key = (index, symbol)
            if key in market_context_keys:
                raise ReplayDivergenceError(f"multiple market context events exist for {symbol} at replay index {index}")
            market_context_keys.add(key)
            if event_type == "market_step":
                if index in market_step_indexes:
                    raise ReplayDivergenceError(f"multiple market events exist for replay index {index}")
                market_step_indexes.add(index)
                if first_type_by_index[index] != "market_step":
                    raise ReplayDivergenceError(f"market_step at replay index {index} must be first")
            else:
                candle_index = payload.get("index")
                if isinstance(candle_index, bool) or not isinstance(candle_index, int) or candle_index != index:
                    raise ReplayDivergenceError("candle index must match replayIndex")
                if first_type_by_index[index] not in MARKET_EVENT_TYPES:
                    raise ReplayDivergenceError(f"market context at replay index {index} must follow the timeline event")
        else:
            non_market_seen_by_index.add(index)
        last_replay_index = index


def rebuild_trading(
    replay,
    history,
    target_index: int,
    default_symbol: str = "BTCUSDT",
    *,
    starting_balance: float = 10000.0,
    fee_rate: float = 0.0005,
    margin_rate: float = 0.1,
    maint_margin_rate: float = 0.05,
) -> PaperTradingEngine:
    """Reconstruct trading state across recorded and navigation-synthesized candles."""
    if target_index < -1:
        raise ValueError("replay target must be -1 or greater")
    if target_index >= len(replay.candles):
        raise ValueError("replay target is outside candle range")

    default_symbol = str(default_symbol).strip().upper()
    if not default_symbol:
        raise ValueError("default replay symbol must be provided")

    engine = PaperTradingEngine(
        starting_balance=starting_balance,
        fee_rate=fee_rate,
        margin_rate=margin_rate,
        maint_margin_rate=maint_margin_rate,
    )
    history = list(history or [])
    validate_history(history)

    if target_index == -1:
        for command in history:
            if command["replayIndex"] != -1:
                break
            _apply_command(engine, command, replay)
        return engine

    commands = [command for command in history if command["replayIndex"] <= target_index]
    commands_by_index = {}
    for command in commands:
        if command["replayIndex"] >= 0:
            commands_by_index.setdefault(command["replayIndex"], []).append(command)

    configured_start_index = replay.start_index if replay.start_index >= 0 and replay.start_index <= target_index else 0
    earliest_command_index = min(
        (command["replayIndex"] for command in commands if command["replayIndex"] >= 0),
        default=configured_start_index,
    )
    start_index = min(configured_start_index, earliest_command_index)

    current_symbol = default_symbol
    for index in range(start_index, target_index + 1):
        index_commands = commands_by_index.get(index, [])
        market_commands = [command for command in index_commands if command["type"] in MARKET_EVENT_TYPES]

        if market_commands:
            if index_commands[0]["type"] not in MARKET_EVENT_TYPES:
                raise ReplayDivergenceError(f"market event at replay index {index} is not first in persisted command order")
            for command in index_commands:
                if command["type"] in MARKET_EVENT_TYPES:
                    current_symbol = str(command["payload"]["symbol"]).strip().upper()
                _apply_command(engine, command, replay)
        else:
            engine.on_candle(replay.candles[index], index, current_symbol)
            for command in index_commands:
                _apply_command(engine, command, replay)

    if engine.index != target_index:
        raise ReplayDivergenceError(f"reconstructed trading index {engine.index} does not match target {target_index}")
    return engine
