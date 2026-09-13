from app.services.replay_service import ReplayService
from app.services.replay_timeline import rebuild_trading


def candle(o, h, l, c, t):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": 0}


def test_rebuild_can_seek_before_replay_start_index():
    service = ReplayService()
    service.load([
        candle(100, 101, 99, 100, 1),
        candle(101, 103, 100, 102, 2),
        candle(102, 105, 101, 104, 3),
        candle(104, 106, 103, 105, 4),
    ])
    service.start(2)

    engine = rebuild_trading(service, [], 1, default_symbol="BTCUSDT")

    assert engine.index == 1
    assert engine.positions == {}
    assert engine.get_latest_market("BTCUSDT")["candle"]["close"] == 102
    assert service.start_index == 2
