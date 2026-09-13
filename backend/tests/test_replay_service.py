import pytest

from app.services.replay_service import MAX_VISIBLE_CANDLES, ReplayService


def candle(index):
    price = 100 + index
    return {"time": index + 1, "open": price, "high": price + 1, "low": price - 1, "close": price, "volume": 1}


def test_visible_candles_are_windowed_for_large_datasets():
    service = ReplayService()
    service.load([candle(index) for index in range(MAX_VISIBLE_CANDLES + 25)])
    service.start(MAX_VISIBLE_CANDLES + 20)

    state = service.state()

    assert len(state["visibleCandles"]) == MAX_VISIBLE_CANDLES
    assert state["visibleStartIndex"] == 21
    assert state["visibleCandles"][0]["time"] == 22
    assert state["visibleCandles"][-1]["time"] == MAX_VISIBLE_CANDLES + 21
