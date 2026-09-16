import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_state import restore_session_bundle, serialize_session


CANDLES = [
    {"time": 1, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10},
    {"time": 2, "open": 101, "high": 103, "low": 100, "close": 102, "volume": 11},
]


def build_active_session():
    replay = ReplayService()
    replay.load(CANDLES)
    replay.start(0)

    trading = PaperTradingEngine()
    trading.on_candle(CANDLES[0], 0, "BTCUSDT")
    return replay, trading


def test_session_serialization_requires_market_context_to_be_the_dataset_candle():
    replay, trading = build_active_session()
    document = serialize_session(replay, trading)

    assert document["tradingMarket"]["BTCUSDT"]["candle"] == CANDLES[0]
    restore_session_bundle(document)

    tampered = document.copy()
    tampered["tradingMarket"] = {
        "BTCUSDT": {
            **document["tradingMarket"]["BTCUSDT"],
            "candle": {**CANDLES[0], "close": 999},
        }
    }

    with pytest.raises(ValueError, match="does not match replay dataset"):
        restore_session_bundle(tampered)


def test_session_restore_rejects_same_ohlc_with_different_candle_metadata():
    replay, trading = build_active_session()
    document = serialize_session(replay, trading)
    original = document["tradingMarket"]["BTCUSDT"]["candle"]
    document["tradingMarket"]["BTCUSDT"]["candle"] = {**original, "volume": 999}

    with pytest.raises(ValueError, match="does not match replay dataset"):
        restore_session_bundle(document)
