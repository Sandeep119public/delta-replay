import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def open_long(engine, quantity=1):
    engine.on_candle(candle(100, 101, 99, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", quantity)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")


def test_trade_net_pnl_matches_account_realized_pnl_after_fees():
    engine = PaperTradingEngine(starting_balance=1000, fee_rate=0.01, margin_rate=0.1)
    open_long(engine)

    trade = engine.close("BTCUSDT", 110, timestamp=3)

    assert trade["grossPnL"] == pytest.approx(10.0)
    assert trade["entryFee"] == pytest.approx(1.0)
    assert trade["exitFee"] == pytest.approx(1.1)
    assert trade["netPnL"] == pytest.approx(7.9)
    assert trade["realizedPnL"] == pytest.approx(7.9)
    assert engine.account.realized_pnl == pytest.approx(7.9)


def test_oversized_partial_close_is_rejected_without_mutation():
    engine = PaperTradingEngine()
    open_long(engine, quantity=2)
    before = engine.export_state()

    with pytest.raises(ValueError, match="invalid close quantity"):
        engine.close("BTCUSDT", 110, quantity=3)

    assert engine.export_state() == before


def test_limit_order_gap_fill_uses_open_price_when_market_is_better():
    engine = PaperTradingEngine()
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=105)

    engine.on_candle(candle(100, 110, 99, 108, 1), 0, "BTCUSDT")

    assert engine.orders[order["id"]]["status"] == "FILLED"
    assert engine.orders[order["id"]]["filledPrice"] == pytest.approx(100)


def test_stop_order_gap_fill_uses_open_price_when_market_is_better():
    engine = PaperTradingEngine()
    order = engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=105)

    engine.on_candle(candle(110, 115, 104, 112, 1), 0, "BTCUSDT")

    assert engine.orders[order["id"]]["status"] == "FILLED"
    assert engine.orders[order["id"]]["filledPrice"] == pytest.approx(110)


def test_multiple_pending_orders_for_one_symbol_only_one_can_fill():
    engine = PaperTradingEngine()
    first = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=100)
    second = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=101)

    events = engine.on_candle(candle(100, 102, 99, 101, 1), 0, "BTCUSDT")

    assert engine.positions["BTCUSDT"]["quantity"] == pytest.approx(1)
    statuses = {first["id"]: engine.orders[first["id"]]["status"], second["id"]: engine.orders[second["id"]]["status"]}
    assert list(statuses.values()).count("FILLED") == 1
    assert list(statuses.values()).count("REJECTED") == 1
    assert any(event["type"] == "ORDER_REJECTED" for event in events)
