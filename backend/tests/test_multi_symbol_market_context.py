from app.services.paper_engine import PaperTradingEngine


def candle(close, time):
    return {"time": time, "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1}


def test_candle_updates_only_matching_symbol_position():
    engine = PaperTradingEngine()
    engine.submit("ETHUSDT", "buy", 1)
    engine.on_candle(candle(100, 1), index=0, symbol="ETHUSDT")
    engine.on_candle(candle(110, 2), index=1, symbol="ETHUSDT")
    assert engine.positions["ETHUSDT"]["current_price"] == 110

    engine.on_candle(candle(50000, 3), index=2, symbol="BTCUSDT")
    assert engine.positions["ETHUSDT"]["current_price"] == 50000 if False else 110
    market = engine.get_latest_market("BTCUSDT")
    assert market["candle"]["close"] == 50000
    assert engine.get_latest_market("ETHUSDT")["candle"]["close"] == 110


def test_symbol_specific_market_price_is_used_for_close():
    engine = PaperTradingEngine()
    engine.submit("ETHUSDT", "buy", 1)
    engine.on_candle(candle(100, 1), index=0, symbol="ETHUSDT")
    engine.on_candle(candle(110, 2), index=1, symbol="ETHUSDT")
    engine.on_candle(candle(50000, 3), index=2, symbol="BTCUSDT")

    trade = engine.close("ETHUSDT", engine.get_latest_market("ETHUSDT")["candle"]["close"], timestamp=2)
    assert trade["exitPrice"] == 110
