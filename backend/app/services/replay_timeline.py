"""Deterministic reconstruction of trading state from the persisted event timeline."""

from .paper_engine import PaperTradingEngine


MARKET_EVENT_TYPES = {"market_step", "candle"}


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
    market_indexes = set()
    for command in history:
        if not isinstance(command, dict):
            raise ReplayDivergenceError("replay history entry must be an object")
        replay_index = command.get("replayIndex")
        if isinstance(replay_index, bool) or not isinstance(replay_index, int) or replay_index < -1:
            raise ReplayDivergenceError("command replayIndex is invalid")
        if replay_index < last_replay_index:
            raise ReplayDivergenceError("command history is not ordered by replay index")
        if command.get("type") in MARKET_EVENT_TYPES:
            if replay_index < 0:
                raise ReplayDivergenceError(f"{command['type']} replayIndex must be non-negative")
            if replay_index in market_indexes:
                raise ReplayDivergenceError(f"multiple market events exist for replay index {replay_index}")
            market_indexes.add(replay_index)
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
    """Replay persisted events exactly, with a pristine market baseline when safe."""
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
    non_market_commands = any(command["type"] not in MARKET_EVENT_TYPES for command in commands)
    market_commands = {
        command["replayIndex"]: command
        for command in commands
        if command["type"] in MARKET_EVENT_TYPES
    }

    configured_start_index = replay.start_index if replay.start_index >= 0 and replay.start_index <= target_index else 0
    earliest_market_index = min(market_commands, default=configured_start_index)
    start_index = min(configured_start_index, earliest_market_index)
    required_indexes = set(range(start_index, target_index + 1))
    missing = sorted(required_indexes - set(market_commands))
    if missing and non_market_commands:
        raise ReplayDivergenceError(f"replay history is missing market events for indexes: {missing}")

    command_iter = iter(commands)
    current_symbol = default_symbol
    next_command = next(command_iter, None)

    for index in range(start_index, target_index + 1):
        if index in market_commands:
            while next_command is not None and int(next_command["replayIndex"]) < index:
                _apply_command(engine, next_command, replay)
                next_command = next(command_iter, None)
            while next_command is not None and int(next_command["replayIndex"]) == index:
                if next_command["type"] in MARKET_EVENT_TYPES:
                    current_symbol = str(next_command["payload"]["symbol"]).strip().upper()
                _apply_command(engine, next_command, replay)
                next_command = next(command_iter, None)
        else:
            engine.on_candle(replay.candles[index], index, current_symbol)

    while next_command is not None and int(next_command["replayIndex"]) <= target_index:
        _apply_command(engine, next_command, replay)
        next_command = next(command_iter, None)

    if engine.index != target_index:
        raise ReplayDivergenceError(f"reconstructed trading index {engine.index} does not match target {target_index}")
    return engine
