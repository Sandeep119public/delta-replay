from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def prime(engine):
    engine.on_candle(candle(100, 105, 95, 100), 0, "BTCUSDT")


def test_buy_limit_gap_down_gets_better_open():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=95)
    events = engine.on_candle(candle(90, 96, 88, 92), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 90
    assert engine.orders[order["id"]]["filledPrice"] == 90
    assert events[0]["type"] == "ORDER_FILLED"


def test_sell_limit_gap_up_gets_better_open():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "sell", 1, "limit", limit_price=105)
    events = engine.on_candle(candle(110, 115, 108, 112), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 110
    assert engine.orders[order["id"]]["filledPrice"] == 110
    assert events[0]["type"] == "ORDER_FILLED"


def test_buy_stop_gap_up_gets_open_price():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=105)
    events = engine.on_candle(candle(110, 115, 108, 112), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 110
    assert engine.orders[order["id"]]["filledPrice"] == 110
    assert events[0]["type"] == "ORDER_FILLED"


def test_sell_stop_gap_down_gets_open_price():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "sell", 1, "stop_market", stop_price=95)
    events = engine.on_candle(candle(90, 94, 85, 88), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 90
    assert engine.orders[order["id"]]["filledPrice"] == 90
    assert events[0]["type"] == "ORDER_FILLED"


def test_untouched_limit_order_remains_pending():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=90)
    engine.on_candle(candle(100, 104, 96, 102), 1, "BTCUSDT")
    assert engine.orders[order["id"]]["status"] == "PENDING"
    assert not engine.positions


def test_ambiguous_stop_and_target_uses_conservative_stop_first():
    engine = PaperTradingEngine()
    prime(engine)
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100), 1, "BTCUSDT")
    engine.set_risk("BTCUSDT", 95, 105)
    engine.on_candle(candle(100, 110, 90, 100), 2, "BTCUSDT")
    assert engine.trades[-1]["exitReason"] == "STOP_LOSS"
    assert engine.trades[-1]["ambiguityResolution"] == "SL_FIRST"


def test_insufficient_margin_rejects_fill_without_changing_balance():
    engine = PaperTradingEngine(starting_balance=100, margin_rate=1)
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 2)
    events = engine.on_candle(candle(100, 101, 99, 100), 1, "BTCUSDT")
    assert engine.orders[order["id"]]["status"] == "REJECTED"
    assert engine.positions == {}
    assert engine.account.wallet_balance == 100
    assert events[0]["type"] == "ORDER_REJECTED"
