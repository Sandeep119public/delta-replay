import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def open_position(engine, side="buy", quantity=10, entry=1000):
    engine.on_candle(candle(entry, entry, entry, entry), 0)
    engine.submit("BTCUSDT", side, quantity)
    engine.on_candle(candle(entry, entry, entry, entry), 1)
    return engine.positions["BTCUSDT"]


def test_initial_margin_is_based_on_entry_not_mark_price():
    engine = PaperTradingEngine(fee_rate=0, margin_rate=0.1, maint_margin_rate=0.05)
    open_position(engine, quantity=10, entry=1000)

    engine.mark("BTCUSDT", 1100)
    account = engine.snapshot()["account"]

    assert account["usedMargin"] == pytest.approx(1000)
    assert account["maintenanceMargin"] == pytest.approx(550)
    assert account["unrealizedPnL"] == pytest.approx(1000)
    assert account["availableMargin"] == pytest.approx(9000)


def test_available_margin_exposes_negative_free_margin():
    engine = PaperTradingEngine(fee_rate=0, margin_rate=0.1, maint_margin_rate=0.05)
    open_position(engine, quantity=10, entry=1000)

    engine.mark("BTCUSDT", 900)
    account = engine.snapshot()["account"]

    assert account["equity"] == pytest.approx(0)
    assert account["usedMargin"] == pytest.approx(1000)
    assert account["availableMargin"] == pytest.approx(-1000)


def test_liquidation_uses_marked_maintenance_margin():
    engine = PaperTradingEngine(fee_rate=0, margin_rate=0.1, maint_margin_rate=0.05)
    open_position(engine, quantity=10, entry=1000)

    events = engine.on_candle(candle(940, 940, 940, 940, 2), 2)

    assert "BTCUSDT" not in engine.positions
    assert any(event["type"] == "LIQUIDATION" for event in events)
    assert engine.account.wallet_balance == pytest.approx(400)


def test_entry_fee_is_realized_immediately_and_account_identity_holds():
    engine = PaperTradingEngine(fee_rate=0.001, margin_rate=0.1, maint_margin_rate=0.05)
    open_position(engine, quantity=1, entry=1000)

    account = engine.snapshot()["account"]
    assert account["walletBalance"] == pytest.approx(9999)
    assert account["realizedPnL"] == pytest.approx(-1)

    engine.close("BTCUSDT", 1100)
    account = engine.snapshot()["account"]
    assert account["walletBalance"] == pytest.approx(10098.8)
    assert account["realizedPnL"] == pytest.approx(98.8)


def test_from_state_rejects_inconsistent_wallet_accounting():
    engine = PaperTradingEngine(fee_rate=0)
    state = engine.export_state()
    state["account"]["walletBalance"] = 12345

    with pytest.raises(ValueError, match="walletBalance"):
        PaperTradingEngine.from_state(state)


def test_from_state_rejects_invalid_pending_order_state():
    engine = PaperTradingEngine(fee_rate=0)
    engine.submit("BTCUSDT", "buy", 1)
    state = engine.export_state()
    state["orders"]["1"]["filledPrice"] = 100

    with pytest.raises(ValueError, match="pending order"):
        PaperTradingEngine.from_state(state)


def test_risk_levels_match_position_direction():
    long_engine = PaperTradingEngine(fee_rate=0)
    open_position(long_engine, quantity=1, entry=100)
    with pytest.raises(ValueError, match="stop_loss"):
        long_engine.set_risk("BTCUSDT", stop_loss=110)
    with pytest.raises(ValueError, match="take_profit"):
        long_engine.set_risk("BTCUSDT", take_profit=90)

    short_engine = PaperTradingEngine(fee_rate=0)
    open_position(short_engine, side="sell", quantity=1, entry=100)
    with pytest.raises(ValueError, match="stop_loss"):
        short_engine.set_risk("BTCUSDT", stop_loss=90)
    with pytest.raises(ValueError, match="take_profit"):
        short_engine.set_risk("BTCUSDT", take_profit=110)
