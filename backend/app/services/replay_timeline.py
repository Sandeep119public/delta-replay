"""Deterministic reconstruction of a trading session at a replay index."""

from copy import deepcopy

from .paper_engine import PaperTradingEngine


class ReplayDivergenceError(ValueError):
    """Raised when persisted user commands cannot be replayed deterministically."""


def _prepare_command_context(engine: PaperTradingEngine, replay, replay_index: int) -> None:
    engine.index = replay_index
    if 0 <= replay_index < len(replay.candles):
        engine._market_by_symbol["BTCUSDT"] = {
            "candle": deepcopy(replay.candles[replay_index]),
            "index": replay_index,
        }


def _apply_command(engine: PaperTradingEngine, command: dict) -> None:
    kind = command["type"]
    payload = command["payload"]

    try:
        if kind == "order":
            engine.submit(
                payload["symbol"],
                payload["side"],
                payload["quantity"],
                payload.get("type", "market"),
                payload.get("limitPrice"),
                payload.get("stopPrice"),
            )
        elif kind == "close":
            trade = engine.close(
                payload["symbol"],
                payload["price"],
                reason="MARKET",
                timestamp=payload.get("timestamp"),
                quantity=payload.get("quantity"),
            )
            if trade is None:
                raise ReplayDivergenceError("close command found no open position")
        elif kind == "cancel":
            engine.cancel(payload["orderId"])
        elif kind == "cancel_all":
            for pending in list(engine.pending_orders()):
                cancelled = engine.cancel(pending["id"])
                if payload.get("reason"):
                    cancelled["cancelReason"] = str(payload["reason"])
                    engine.orders[pending["id"]]["cancelReason"] = str(payload["reason"])
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
        elif kind == "capital":
            index = engine.index
            market = deepcopy(engine._market_by_symbol)
            balance = payload["balance"]
            fee_rate = engine.fee_rate
            margin_rate = engine.margin_rate
            maint_margin_rate = engine.maint_margin_rate
            engine.__init__(balance, fee_rate, margin_rate, maint_margin_rate)
            engine.index = index
            engine._market_by_symbol = market
        elif kind == "fee_rate":
            engine.set_fee_rate(payload["rate"])
        else:
            raise ReplayDivergenceError(f"unsupported replay command: {kind}")
    except ReplayDivergenceError:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise ReplayDivergenceError(f"replay command {kind} diverged: {exc}") from exc


def rebuild_trading(replay, history, target_index: int) -> PaperTradingEngine:
    if target_index < 0:
        engine = PaperTradingEngine()
        for command in history:
            if command["replayIndex"] == -1:
                _apply_command(engine, command)
        return engine
    if not replay.candles:
        return PaperTradingEngine()
    if target_index >= len(replay.candles):
        raise ValueError("replay target is outside candle range")

    start_index = replay.start_index if replay.start_index >= 0 else 0
    if target_index < start_index:
        return PaperTradingEngine()

    engine = PaperTradingEngine()
    commands_by_index = {}
    for command in history:
        replay_index = int(command["replayIndex"])
        if replay_index <= target_index:
            commands_by_index.setdefault(replay_index, []).append(command)

    for command in commands_by_index.get(-1, []):
        _apply_command(engine, command)

    for candle_index in range(start_index + 1, target_index + 1):
        command_index = candle_index - 1
        for command in commands_by_index.get(command_index, []):
            _prepare_command_context(engine, replay, command_index)
            _apply_command(engine, command)
        candle = replay.candles[candle_index]
        engine.on_candle(candle, candle_index, "BTCUSDT")

    for command in commands_by_index.get(target_index, []):
        _prepare_command_context(engine, replay, target_index)
        _apply_command(engine, command)
    return engine
