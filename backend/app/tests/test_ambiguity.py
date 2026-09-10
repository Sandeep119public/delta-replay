import pytest

from app.domain.ambiguity import evaluate


def position():
    return {
        "side": "long",
        "opened_index": 0,
        "stop_loss": 90.0,
        "take_profit": 110.0,
        "stop_loss_created_index": 0,
        "take_profit_created_index": 0,
    }


def test_realistic_policy_executes_gap_through_stop_at_open():
    result = evaluate(
        position(),
        {"time": 2, "open": 85, "high": 95, "low": 84, "close": 92},
        1,
    )
    assert result["triggered"] is True
    assert result["exitReason"] == "STOP_LOSS"
    assert result["exitPrice"] == 85


def test_ambiguous_bar_uses_conservative_stop_first_policy():
    result = evaluate(
        position(),
        {"time": 2, "open": 100, "high": 115, "low": 85, "close": 105},
        1,
    )
    assert result["isAmbiguous"] is True
    assert result["ambiguityResolution"] == "SL_FIRST"
    assert result["exitReason"] == "STOP_LOSS"


def test_unknown_execution_policy_is_rejected():
    with pytest.raises(ValueError, match="unsupported execution policy"):
        evaluate(position(), {"time": 2, "open": 100, "high": 115, "low": 85, "close": 105}, 1, execution_policy="UNKNOWN")
