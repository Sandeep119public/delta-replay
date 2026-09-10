import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_state import restore_session, serialize_session


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def test_restore_rejects_future_market_context():
    trading = PaperTradingEngine()
    trading.on_candle(candle(100, 101, 99, 100), 0, "BTCUSDT")
    document = serialize_session(ReplayService(), trading)
    document["tradingMarket"]["BTCUSDT"]["index"] = 1

    with pytest.raises(ValueError, match="outside trading timeline"):
        restore_session(document)


def test_restore_rejects_non_canonical_market_symbol():
    trading = PaperTradingEngine()
    trading.on_candle(candle(100, 101, 99, 100), 0, "BTCUSDT")
    document = serialize_session(ReplayService(), trading)
    document["tradingMarket"] = {"btcusdt": document["tradingMarket"]["BTCUSDT"]}

    with pytest.raises(ValueError, match="market symbol"):
        restore_session(document)
