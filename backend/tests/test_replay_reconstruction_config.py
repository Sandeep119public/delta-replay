from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import rebuild_trading


def candle(o, h, l, c, t):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": 0}


def test_rebuild_preserves_session_trading_configuration():
    replay = ReplayService()
    replay.load([
        candle(100, 101, 99, 100, 1),
        candle(101, 103, 100, 102, 2),
        candle(102, 105, 101, 104, 3),
    ])
    replay.start(0)

    history = [
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
        {"type": "market_step", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {
            "type": "order",
            "replayIndex": 1,
            "payload": {
                "symbol": "BTCUSDT",
                "side": "buy",
                "quantity": 1,
                "type": "market",
                "limitPrice": None,
                "stopPrice": None,
            },
        },
        {"type": "market_step", "replayIndex": 2, "payload": {"symbol": "BTCUSDT"}},
    ]

    rebuilt = rebuild_trading(
        replay,
        history,
        2,
        starting_balance=25000,
        fee_rate=0.002,
        margin_rate=0.25,
        maint_margin_rate=0.1,
    )

    direct = PaperTradingEngine(
        starting_balance=25000,
        fee_rate=0.002,
        margin_rate=0.25,
        maint_margin_rate=0.1,
    )
    direct.on_candle(replay.candles[0], 0, "BTCUSDT")
    direct.on_candle(replay.candles[1], 1, "BTCUSDT")
    direct.submit("BTCUSDT", "buy", 1, created_index=1)
    direct.on_candle(replay.candles[2], 2, "BTCUSDT")

    assert rebuilt.snapshot() == direct.snapshot()
    assert rebuilt.account.starting_balance == 25000
    assert rebuilt.fee_rate == 0.002
    assert rebuilt.margin_rate == 0.25
    assert rebuilt.maint_margin_rate == 0.1
