from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import ReplayDivergenceError, rebuild_trading


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


def market_step(index, symbol="BTCUSDT"):
    return {"type": "market_step", "replayIndex": index, "payload": {"symbol": symbol}}


def order(index, symbol="BTCUSDT"):
    return {
        "type": "order",
        "replayIndex": index,
        "payload": {
            "symbol": symbol,
            "side": "buy",
            "quantity": 1,
            "type": "market",
            "limitPrice": None,
            "stopPrice": None,
        },
    }


def test_rebuild_replays_exact_event_order_and_market_timing():
    service = replay()
    history = [
        market_step(0),
        market_step(1),
        order(1),
        market_step(2),
    ]

    engine = rebuild_trading(service, history, 1)
    assert engine.index == 1
    assert engine.positions == {}
    assert engine.orders[1]["status"] == "PENDING"
    assert engine.orders[1]["createdIndex"] == 1

    engine = rebuild_trading(service, history, 2)
    assert engine.positions["BTCUSDT"]["entry_price"] == 102
    assert engine.orders[1]["status"] == "FILLED"


def test_rebuild_preserves_per_event_symbol_market_context():
    service = replay()
    history = [
        market_step(0, "BTCUSDT"),
        market_step(1, "ETHUSDT"),
    ]

    engine = rebuild_trading(service, history, 1)

    assert engine.index == 1
    assert engine.get_latest_market("BTCUSDT")["candle"]["close"] == 100
    assert engine.get_latest_market("ETHUSDT")["candle"]["close"] == 102


def test_rebuild_applies_same_index_commands_in_persisted_order():
    service = replay()
    history = [
        market_step(0),
        market_step(1),
        order(1),
        market_step(2),
        {
            "type": "risk",
            "replayIndex": 2,
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
        market_step(0),
        market_step(1),
        order(1),
        market_step(2),
        {
            "type": "funding",
            "replayIndex": 2,
            "payload": {"rate": 0.01, "timestamp": 3, "symbol": "BTCUSDT", "markPrice": 104},
        },
    ]

    rebuilt = rebuild_trading(service, history, 2)
    direct = PaperTradingEngine()
    direct.on_candle(service.candles[0], 0, "BTCUSDT")
    direct.on_candle(service.candles[1], 1, "BTCUSDT")
    direct.submit("BTCUSDT", "buy", 1, created_index=1)
    direct.on_candle(service.candles[2], 2, "BTCUSDT")
    direct.apply_funding(0.01, timestamp=3, symbol="BTCUSDT", mark_price=104)
    assert rebuilt.snapshot() == direct.snapshot()


def test_rebuild_rejects_incomplete_market_timeline_when_trading_commands_exist():
    service = replay()
    history = [market_step(0), order(1)]

    try:
        rebuild_trading(service, history, 1)
    except ReplayDivergenceError as exc:
        assert "missing market events" in str(exc)
    else:
        raise AssertionError("incomplete market history with trading commands must be rejected")


def test_rebuild_can_create_a_pristine_market_baseline_for_forward_seek():
    service = replay()
    history = [market_step(0)]

    engine = rebuild_trading(service, history, 2)
    assert engine.index == 2
    assert engine.positions == {}
    assert engine.get_latest_market("BTCUSDT")["candle"]["close"] == 104
