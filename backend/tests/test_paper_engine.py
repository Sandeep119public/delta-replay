import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def fill_long(engine):
    engine.on_candle(candle(100, 105, 95, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 2)
    engine.on_candle(candle(110, 115, 108, 112, 2), 1, "BTCUSDT")


def test_market_order_executes_next_bar_open():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 105, 95, 102, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(110, 115, 108, 112, 2), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 110


def test_partial_close_preserves_remaining_position():
    engine = PaperTradingEngine()
    fill_long(engine)
    engine.close("BTCUSDT", 110, quantity=1)
    assert engine.positions["BTCUSDT"]["quantity"] == 1
    assert engine.trades[-1]["quantity"] == 1


def test_pending_order_can_be_cancelled():
    engine = PaperTradingEngine()
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=50)
    engine.cancel(order["id"])
    assert engine.orders[order["id"]]["status"] == "CANCELLED"


def test_validation_rejects_bad_orders():
    engine = PaperTradingEngine()
    for args in [("BTCUSDT", "hold", 1), ("BTCUSDT", "buy", 0), ("BTCUSDT", "buy", 1, "limit")]:
        with pytest.raises(ValueError):
            engine.submit(*args)


def test_risk_does_not_trigger_on_creation_bar():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 101, 99, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")
    engine.set_risk("BTCUSDT", 90, 110)
    engine.on_candle(candle(100, 101, 99, 100, 3), 2, "BTCUSDT")
    assert "BTCUSDT" in engine.positions
    engine.on_candle(candle(100, 120, 80, 100, 4), 3, "BTCUSDT")
    assert "BTCUSDT" not in engine.positions
    assert engine.trades[-1]["exitReason"] == "STOP_LOSS"


def test_risk_update_is_atomic_when_take_profit_is_invalid():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 101, 99, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")
    engine.set_risk("BTCUSDT", 90, 110)
    before = engine.positions["BTCUSDT"].copy()
    with pytest.raises(ValueError):
        engine.set_risk("BTCUSDT", 95, 99)
    assert engine.positions["BTCUSDT"] == before


def test_candle_index_rejects_fractional_backward_and_forward_jumps():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 101, 99, 100), 0, "BTCUSDT")
    with pytest.raises(ValueError):
        engine.on_candle(candle(100, 101, 99, 100), 1.5, "BTCUSDT")
    with pytest.raises(ValueError):
        engine.on_candle(candle(100, 101, 99, 100), -1, "BTCUSDT")
    with pytest.raises(ValueError):
        engine.on_candle(candle(100, 101, 99, 100), 2, "BTCUSDT")
    assert engine.index == 0


def test_same_index_identical_candle_is_idempotent():
    engine = PaperTradingEngine()
    bar = candle(100, 105, 95, 101, 1)
    engine.on_candle(bar, 0, "BTCUSDT")
    assert engine.on_candle(dict(bar), 0, "BTCUSDT") == []
    assert engine.index == 0


def test_same_index_conflicting_candle_is_rejected():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 105, 95, 101, 1), 0, "BTCUSDT")
    with pytest.raises(ValueError, match="same-index candle does not match existing market context"):
        engine.on_candle(candle(100, 106, 95, 101, 1), 0, "BTCUSDT")


def test_from_state_rejects_fabricated_fee_total():
    engine = PaperTradingEngine()
    fill_long(engine)
    state = engine.export_state()
    state["account"]["totalFees"] += 1
    state["account"]["walletBalance"] += 1
    state["account"]["realizedPnL"] += 1

    with pytest.raises(ValueError, match="totalFees is inconsistent"):
        PaperTradingEngine.from_state(state)


def test_from_state_rejects_fabricated_realized_pnl():
    engine = PaperTradingEngine()
    fill_long(engine)
    engine.close("BTCUSDT", 115)
    state = engine.export_state()
    state["account"]["realizedPnL"] += 1
    state["account"]["walletBalance"] += 1

    with pytest.raises(ValueError, match="realizedPnL is inconsistent"):
        PaperTradingEngine.from_state(state)


def test_from_state_rejects_inconsistent_funding_aggregate():
    engine = PaperTradingEngine()
    fill_long(engine)
    engine.apply_funding(0.01, symbol="BTCUSDT", mark_price=112)
    state = engine.export_state()
    state["account"]["totalFundingPaid"] += 1
    state["account"]["netFunding"] -= 1
    state["account"]["walletBalance"] += 0

    with pytest.raises(ValueError, match="totalFundingPaid is inconsistent"):
        PaperTradingEngine.from_state(state)
