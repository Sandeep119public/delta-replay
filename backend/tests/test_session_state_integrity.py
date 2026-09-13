import copy

import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_state import restore_session_bundle, serialize_session


def candle(o, h, l, c, t):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": 0}


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


def test_restore_rejects_replay_and_trading_index_divergence():
    document = session_document()
    document["trading"]["index"] = -1
    with pytest.raises(ValueError, match="indices must match"):
        restore_session_bundle(document)


def test_restore_rejects_market_context_not_from_replay_dataset():
    document = session_document()
    document["tradingMarket"]["BTCUSDT"]["candle"]["close"] = 999
    with pytest.raises(ValueError, match="does not match replay candle"):
        restore_session_bundle(document)


def test_restore_rejects_unknown_or_out_of_order_history():
    document = session_document()
    invalid = copy.deepcopy(document)
    invalid["history"].append({"type": "unknown", "replayIndex": 0, "payload": {}})
    with pytest.raises(ValueError, match="unsupported session history event type"):
        restore_session_bundle(invalid)

    invalid = copy.deepcopy(document)
    invalid["history"].extend([
        {"type": "order", "replayIndex": 1, "payload": {"symbol": "BTCUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
    ])
    with pytest.raises(ValueError, match="ordered by replayIndex"):
        restore_session_bundle(invalid)
