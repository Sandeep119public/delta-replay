from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def fill_long(engine):
    engine.on_candle(candle(100, 105, 95, 100, 1), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 2)
    engine.on_candle(candle(110, 115, 108, 112, 2), 1, "BTCUSDT")


def test_risk_can_be_cleared_independently():
    engine = PaperTradingEngine()
    fill_long(engine)
    position = engine.set_risk("BTCUSDT", 90, 130)

    assert position["stop_loss"] == 90
    assert position["take_profit"] == 130

    position = engine.clear_stop_loss("BTCUSDT")
    assert position["stop_loss"] is None
    assert position["stop_loss_created_index"] == -1
    assert position["take_profit"] == 130
    assert position["take_profit_created_index"] == 1

    position = engine.clear_take_profit("BTCUSDT")
    assert position["stop_loss"] is None
    assert position["take_profit"] is None
    assert position["take_profit_created_index"] == -1
