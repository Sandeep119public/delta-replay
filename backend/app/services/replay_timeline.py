"""Deterministic reconstruction of trading state from the persisted event timeline."""

from .paper_engine import PaperTradingEngine


MARKET_EVENT_TYPES = {"market_step", "candle"}


def latest_market_step_symbol(history):
    """Return the symbol from the most recent canonical replay market step."""
    for command in reversed(list(history or [])):
        if command.get("type") != "market_step":
            continue
        symbol = command.get("payload", {}).get("symbol")
        if isinstance(symbol, str) and symbol.strip():
            return symbol.strip().upper()
    raise ReplayDivergenceError("replay history has no canonical market symbol")


class ReplayDivergenceError(ValueError):
    """Raised when persisted commands cannot reproduce the trading state."""


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


def _validate_history_order(history) -> None:
    last_replay_index = -1
    market_context_keys = set()
    market_step_indexes = set()
    first_type_by_index = {}
    non_market_seen_by_index = set()
    for command in history:
        if not isinstance(command, dict):
            raise ReplayDivergenceError("replay history entry must be an object")
        replay_index = command.get("replayIndex")
        if isinstance(replay_index, bool) or not isinstance(replay_index, int) or replay_index < -1:
            raise ReplayDivergenceError("command replayIndex is invalid")
        if replay_index < last_replay_index:
            raise ReplayDivergenceError("command history is not ordered by replay index")
        kind = command.get("type")
        if replay_index not in first_type_by_index:
            first_type_by_index[replay_index] = kind
        if kind in MARKET_EVENT_TYPES:
            if replay_index < 0:
                raise ReplayDivergenceError(f"{kind} replayIndex must be non-negative")
            if replay_index in non_market_seen_by_index:
                raise ReplayDivergenceError(f"market context at replay index {replay_index} must precede trading commands")
            payload = command.get("payload")
            if not isinstance(payload, dict):
                raise ReplayDivergenceError(f"{kind} payload must be an object")
            symbol = payload.get("symbol")
            if not isinstance(symbol, str) or not symbol.strip() or symbol != symbol.strip().upper():
                raise ReplayDivergenceError(f"{kind} symbol is invalid")
            key = (replay_index, symbol)
            if key in market_context_keys:
                raise ReplayDivergenceError(f"multiple market context events exist for {symbol} at replay index {replay_index}")
            market_context_keys.add(key)
            if kind == "market_step":
                if replay_index in market_step_indexes:
                    raise ReplayDivergenceError(f"multiple market events exist for replay index {replay_index}")
                market_step_indexes.add(replay_index)
                if first_type_by_index[replay_index] != "market_step":
                    raise ReplayDivergenceError(f"market_step at replay index {replay_index} must be first")
            else:
                candle_index = payload.get("index")
                if isinstance(candle_index, bool) or not isinstance(candle_index, int) or candle_index != replay_index:
                    raise ReplayDivergenceError("candle index must match replayIndex")
                if first_type_by_index[replay_index] not in MARKET_EVENT_TYPES:
                    raise ReplayDivergenceError(f"market context at replay index {replay_index} must follow the timeline event")
        else:
            non_market_seen_by_index.add(replay_index)
        last_replay_index = replay_index


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
    _validate_history_order(history)

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
