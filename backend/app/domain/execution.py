"""Canonical OHLC execution rules shared by replay and trading components."""

from typing import Literal

from .ambiguity import evaluate

ExecutionOrderType = Literal["market", "limit", "stop_market"]


EXECUTION_MODEL = "NEXT_BAR_OPEN_WITH_OHLC_GAPS"


def fill_price(order: dict, candle: dict, *, candle_index: int) -> float | None:
    """Return the deterministic fill price for an eligible order on one candle."""
    order_type = order["type"]
    side = order["side"]

    if order_type == "market":
        return candle["open"] if candle_index > order["createdIndex"] else None

    if order_type == "limit":
        touched = (
            side == "buy" and candle["low"] <= order["limitPrice"]
        ) or (
            side == "sell" and candle["high"] >= order["limitPrice"]
        )
        if not touched:
            return None
        return (
            min(order["limitPrice"], candle["open"])
            if side == "buy"
            else max(order["limitPrice"], candle["open"])
        )

    if order_type == "stop_market":
        touched = (
            side == "buy" and candle["high"] >= order["stopPrice"]
        ) or (
            side == "sell" and candle["low"] <= order["stopPrice"]
        )
        if not touched:
            return None
        return (
            max(order["stopPrice"], candle["open"])
            if side == "buy"
            else min(order["stopPrice"], candle["open"])
        )

    raise ValueError(f"unsupported order type: {order_type}")


def risk_exit(position: dict, candle: dict, candle_index: int) -> dict:
    """Apply the canonical ambiguity/execution policy to SL/TP exits."""
    return evaluate(position, candle, candle_index)
