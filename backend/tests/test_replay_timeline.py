from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import rebuild_trading


def candle(o, h, l, c, t):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": 0}


def replay():
    service = ReplayService()
    service.load([
        candle(100, 101, 99, 100, 1),
        candle(101, 103, 100, 102, 2),
        candle(102, 105, 101, 104, 3),
        candle(104, 106, 103, 105, 4),
    ])
    service.start(0)
    return service


def test_rebuild_preserves_market_order_timing():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "order", "replayIndex": 1,
            "payload": {"symbol": "BTCUSDT", "side": "buy", "quantity": 1,
                        "type": "market", "limitPrice": None, "stopPrice": None},
        },
        {"type": "market_step", "replayIndex": 2, "payload": {"symbol": "BTCUSDT"}},
    ]

    engine = rebuild_trading(service, history, 1)
    assert engine.index == 1
    assert engine.positions == {}
    assert engine.orders[1]["status"] == "PENDING"

    engine = rebuild_trading(service, history, 2)
    assert engine.positions["BTCUSDT"]["entry_price"] == 102
    assert engine.orders[1]["status"] == "FILLED"


def test_rebuild_uses_persisted_symbol_for_market_steps():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 1, "payload": {"symbol": "ETHUSDT"}},
    ]

    engine = rebuild_trading(service, history, 1)

    assert engine.index == 1
    assert engine.get_latest_market("BTCUSDT")["candle"]["close"] == 100
    assert engine.get_latest_market("ETHUSDT")["candle"]["close"] == 102


def test_rebuild_includes_same_index_risk_command_after_candle():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "order", "replayIndex": 1,
            "payload": {"symbol": "BTCUSDT", "side": "buy", "quantity": 1,
                        "type": "market", "limitPrice": None, "stopPrice": None},
        },
        {"type": "market_step", "replayIndex": 2, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "risk", "replayIndex": 2,
            "payload": {"symbol": "BTCUSDT", "stopLoss": 99, "takeProfit": 110},
        },
    ]

    engine = rebuild_trading(service, history, 2)
    position = engine.positions["BTCUSDT"]
    assert position["stop_loss"] == 99
    assert position["take_profit"] == 110
    assert position["stop_loss_created_index"] == 2
    assert position["take_profit_created_index"] == 2


def test_rebuild_reproduces_funding_accounting():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "order", "replayIndex": 1,
            "payload": {"symbol": "BTCUSDT", "side": "buy", "quantity": 1,
                        "type": "market", "limitPrice": None, "stopPrice": None},
        },
        {"type": "market_step", "replayIndex": 2, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "funding", "replayIndex": 2,
            "payload": {"rate": 0.01, "timestamp": 3, "symbol": "BTCUSDT", "markPrice": 104},
        },
    ]

    rebuilt = rebuild_trading(service, history, 2)
    direct = PaperTradingEngine()
    direct.on_candle(service.candles[0], 0, "BTCUSDT")
    direct.on_candle(service.candles[1], 1, "BTCUSDT")
    direct.submit("BTCUSDT", "buy", 1)
    direct.on_candle(service.candles[2], 2, "BTCUSDT")
    direct.apply_funding(0.01, timestamp=3, symbol="BTCUSDT", mark_price=104)
    assert rebuilt.snapshot() == direct.snapshot()
