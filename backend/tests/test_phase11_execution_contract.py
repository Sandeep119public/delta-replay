import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def test_limit_order_gets_price_improvement_when_gap_opens_through_limit():
    engine = PaperTradingEngine(fee_rate=0)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=100)
    events = engine.on_candle(candle(90, 95, 85, 92, 1), 0)
    assert engine.positions["BTCUSDT"]["entry_price"] == 90
    assert engine.orders[order["id"]]["status"] == "FILLED"
    assert any(event["type"] == "ORDER_FILLED" for event in events)


def test_limit_order_fill_is_not_duplicated():
    engine = PaperTradingEngine(fee_rate=0)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=95)
    engine.on_candle(candle(100, 105, 90, 100, 1), 0)
    engine.on_candle(candle(100, 105, 90, 100, 1), 0)
    assert engine.orders[order["id"]]["status"] == "FILLED"
    assert engine.positions["BTCUSDT"]["entry_price"] == 95


def test_market_order_never_fills_on_creation_index():
    engine = PaperTradingEngine(fee_rate=0)
    engine.on_candle(candle(100, 100, 100, 100, 1), 0)
    order = engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(110, 110, 110, 110, 2), 0)
    assert engine.orders[order["id"]]["status"] == "PENDING"
    assert not engine.positions


def test_orders_for_other_symbols_are_not_executed():
    engine = PaperTradingEngine(fee_rate=0)
    btc = engine.submit("BTCUSDT", "buy", 1)
    eth = engine.submit("ETHUSDT", "buy", 1)
    engine.on_candle(candle(100, 100, 100, 100, 1), 0, "BTCUSDT")
    assert engine.orders[btc["id"]]["status"] == "FILLED"
    assert engine.orders[eth["id"]]["status"] == "PENDING"


def test_cancelled_order_never_reactivates():
    engine = PaperTradingEngine(fee_rate=0)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=100)
    engine.cancel(order["id"])
    engine.on_candle(candle(90, 110, 80, 100, 1), 0)
    assert engine.orders[order["id"]]["status"] == "CANCELLED"
    assert not engine.positions


def test_stop_market_gap_uses_open_when_open_crosses_stop():
    engine = PaperTradingEngine(fee_rate=0)
    order = engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=100)
    engine.on_candle(candle(110, 115, 105, 112, 1), 0)
    assert engine.orders[order["id"]]["status"] == "FILLED"
    assert engine.positions["BTCUSDT"]["entry_price"] == 110


def test_state_round_trip_preserves_pending_execution():
    engine = PaperTradingEngine(fee_rate=0)
    engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=95)
    engine.on_candle(candle(100, 100, 100, 100, 1), 0)
    state = engine.export_state()
    restored = PaperTradingEngine.from_state(state)
    restored.on_candle(candle(100, 101, 90, 100, 2), 1)
    assert restored.positions["BTCUSDT"]["entry_price"] == 95
    assert restored.orders[1]["status"] == "FILLED"


def test_invalid_order_configuration_cannot_enter_engine():
    engine = PaperTradingEngine(fee_rate=0)
    with pytest.raises(ValueError):
        engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=0)
    with pytest.raises(ValueError):
        engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=-1)
