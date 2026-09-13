"""Compatibility risk evaluator backed by the canonical ambiguity engine."""

from .ambiguity import evaluate


def evaluate_risk(position, candle, policy="conservative"):
    """Return the historical tuple contract using canonical SL/TP semantics."""
    normalized = {
        "opened_index": position.get("opened_index", -1),
        "stop_loss": position.get("stop_loss"),
        "take_profit": position.get("take_profit"),
        "stop_loss_created_index": position.get("stop_loss_created_index", -1),
        "take_profit_created_index": position.get("take_profit_created_index", -1),
        "side": position.get("side"),
    }
    policy_map = {
        "conservative": "CONSERVATIVE",
        "tp_first": "TP_FIRST",
        "open_proximity": "OPEN_PROXIMITY",
    }
    resolved_policy = policy_map.get(str(policy).strip().lower())
    if resolved_policy is None:
        raise ValueError(f"unsupported risk policy: {policy}")
    result = evaluate(normalized, candle, candle.get("index", 0), policy=resolved_policy)
    if not result["triggered"]:
        return None, None, result["isAmbiguous"]
    return result["exitReason"], result["exitPrice"], result["isAmbiguous"]
