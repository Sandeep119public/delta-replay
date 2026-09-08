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
        try:
            engine.submit(*args)
            assert False
        except ValueError:
            pass


def test_risk_does_not_trigger_on_creation_bar():
    engine = PaperTradingEngine()
    engine.on_candle(candle(100, 101, 99, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")
    engine.set_risk("BTCUSDT", 90, 110)
    engine.on_candle(candle(100, 120, 80, 100, 3), 1, "BTCUSDT")
    assert "BTCUSDT" in engine.positions
    engine.on_candle(candle(100, 120, 80, 100, 4), 2, "BTCUSDT")
    assert "BTCUSDT" not in engine.positions
    assert engine.trades[-1]["exitReason"] == "STOP_LOSS"
