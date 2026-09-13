import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def filled_engine():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 105, 95, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(110, 115, 108, 112, 2), 1, "BTCUSDT")
    return engine


def test_clearing_stop_loss_removes_its_creation_marker():
    engine = filled_engine()
    engine.set_risk("BTCUSDT", stop_loss=90)
    assert engine.positions["BTCUSDT"]["stop_loss_created_index"] == 1

    engine.clear_stop_loss("BTCUSDT")

    position = engine.positions["BTCUSDT"]
    assert position["stop_loss"] is None
    assert position["stop_loss_created_index"] == -1
    engine.export_state()


def test_clearing_take_profit_removes_its_creation_marker():
    engine = filled_engine()
    engine.set_risk("BTCUSDT", take_profit=130)
    assert engine.positions["BTCUSDT"]["take_profit_created_index"] == 1

    engine.clear_take_profit("BTCUSDT")

    position = engine.positions["BTCUSDT"]
    assert position["take_profit"] is None
    assert position["take_profit_created_index"] == -1
    engine.export_state()


def test_clear_risk_removes_both_levels_and_creation_markers():
    engine = filled_engine()
    engine.set_risk("BTCUSDT", stop_loss=90, take_profit=130)

    engine.clear_risk("BTCUSDT")

    position = engine.positions["BTCUSDT"]
    assert position["stop_loss"] is None
    assert position["take_profit"] is None
    assert position["stop_loss_created_index"] == -1
    assert position["take_profit_created_index"] == -1
    engine.export_state()


def test_restore_rejects_cleared_risk_with_stale_creation_marker():
    engine = filled_engine()
    engine.set_risk("BTCUSDT", stop_loss=90)
    state = engine.export_state()
    state["positions"]["BTCUSDT"]["stop_loss"] = None

    with pytest.raises(ValueError, match="position stop_loss_created_index must be -1 when risk is cleared"):
        PaperTradingEngine.from_state(state)
