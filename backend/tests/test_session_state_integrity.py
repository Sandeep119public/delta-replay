import copy

import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_state import restore_session_bundle, serialize_session


def candle(o, h, l, c, t):
    return {"time": t, "open": o, "high": h, "low": l, "close": c}


def session_document():
    replay = ReplayService()
    replay.load([candle(100, 101, 99, 100, 1), candle(101, 103, 100, 102, 2)])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    return serialize_session(replay, trading, [{
        "type": "market_step",
        "replayIndex": 0,
        "payload": {"symbol": "BTCUSDT"},
    }])


def test_restore_preserves_replay_and_trading_cursors():
    document = session_document()
    replay, trading, history = restore_session_bundle(document)
    assert replay.index == 0
    assert trading.index == 0
    assert history == document["history"]


def test_restore_allows_trading_to_lag_replay_cursor():
    document = session_document()
    document["replay"]["index"] = 1
    document["replay"]["status"] = "paused"
    replay, trading, _ = restore_session_bundle(document)
    assert replay.index == 1
    assert trading.index == 0


def test_restore_rejects_trading_cursor_ahead_of_replay():
    document = session_document()
    document["trading"]["index"] = 1
    with pytest.raises(ValueError, match="trading index cannot be ahead of replay index"):
        restore_session_bundle(document)


def test_restore_rejects_market_context_beyond_trading_timeline():
    document = session_document()
    invalid = copy.deepcopy(document)
    invalid["tradingMarket"]["BTCUSDT"]["index"] = invalid["trading"]["index"] + 1
    with pytest.raises(ValueError, match="outside trading timeline"):
        restore_session_bundle(invalid)


def test_restore_rejects_replay_trading_cursor_mismatch_with_trading_activity():
    replay = ReplayService()
    replay.load([candle(100, 101, 99, 100, 1)])
    replay.start(0)
    trading = PaperTradingEngine()
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    document = serialize_session(replay, trading)
    document["replay"]["index"] = -1
    document["replay"]["startIndex"] = -1
    document["replay"]["status"] = "ready"
    with pytest.raises(ValueError, match="trading index cannot be ahead of replay index"):
        restore_session_bundle(document)


def test_restore_rejects_noncanonical_market_symbol():
    document = session_document()
    invalid = copy.deepcopy(document)
    invalid["tradingMarket"] = {"btcusdt": invalid["tradingMarket"]["BTCUSDT"]}
    with pytest.raises(ValueError, match="invalid market symbol"):
        restore_session_bundle(invalid)


def test_restore_rejects_unknown_or_out_of_order_history():
    document = session_document()
    invalid = copy.deepcopy(document)
    invalid["history"].append({"type": "unknown", "replayIndex": 0, "payload": {}})
    with pytest.raises(ValueError, match="unsupported session history event type"):
        restore_session_bundle(invalid)

    invalid = copy.deepcopy(document)
    invalid["replay"]["index"] = 1
    invalid["replay"]["startIndex"] = 0
    invalid["replay"]["status"] = "paused"
    invalid["trading"]["index"] = 1
    invalid["history"].extend([
        {"type": "order", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
    ])
    with pytest.raises(ValueError, match="ordered by replayIndex"):
        restore_session_bundle(invalid)
