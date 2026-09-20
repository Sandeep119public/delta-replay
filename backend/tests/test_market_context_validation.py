import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_session import ReplaySession
from app.services.replay_service import ReplayService
from app.services.session_state import restore_replay_session, serialize_replay_session


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def test_restore_rejects_future_market_context():
    replay = ReplayService()
    replay.load([candle(100, 101, 99, 100)])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    document = serialize_replay_session(ReplaySession(replay=replay, trading=trading))
    document["tradingMarket"]["BTCUSDT"]["index"] = 1

    with pytest.raises(ValueError, match="outside trading timeline"):
        restore_replay_session(document)


def test_restore_rejects_non_canonical_market_symbol():
    replay = ReplayService()
    replay.load([candle(100, 101, 99, 100)])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    document = serialize_replay_session(ReplaySession(replay=replay, trading=trading))
    document["tradingMarket"] = {"btcusdt": document["tradingMarket"]["BTCUSDT"]}

    with pytest.raises(ValueError, match="market symbol"):
        restore_replay_session(document)


def test_restore_rejects_uninitialized_market_context_entry():
    replay = ReplayService()
    replay.load([candle(100, 101, 99, 100)])
    trading = PaperTradingEngine()
    document = serialize_replay_session(ReplaySession(replay=replay, trading=trading))
    document["tradingMarket"] = {"BTCUSDT": {"index": -1}}

    with pytest.raises(ValueError, match="outside trading timeline"):
        restore_replay_session(document)


def test_restore_rejects_open_position_without_market_context():
    replay = ReplayService()
    replay.load([
        candle(100, 101, 99, 100),
        candle(100, 101, 99, 100, 2),
    ])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    trading.submit("BTCUSDT", "buy", 1)
    replay.step()
    trading.on_candle(replay.candles[1], 1, "BTCUSDT")
    document = serialize_replay_session(ReplaySession(replay=replay, trading=trading))
    del document["tradingMarket"]["BTCUSDT"]

    with pytest.raises(ValueError, match="open positions require market context"):
        restore_replay_session(document)


def test_restore_rejects_market_context_predating_open_position():
    replay = ReplayService()
    replay.load([
        candle(100, 101, 99, 100),
        candle(101, 102, 100, 101, 2),
    ])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    trading.submit("BTCUSDT", "buy", 1)
    replay.step()
    trading.on_candle(replay.candles[1], 1, "BTCUSDT")
    document = serialize_replay_session(ReplaySession(replay=replay, trading=trading))
    document["tradingMarket"]["BTCUSDT"]["index"] = 0
    document["trading"]["positions"]["BTCUSDT"]["opened_index"] = 1

    with pytest.raises(ValueError, match="predates its open position"):
        restore_replay_session(document)
