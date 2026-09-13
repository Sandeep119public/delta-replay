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


def test_reset_preserves_ended_status_when_start_index_is_final_candle():
    service = ReplayService()
    service.load([candle(0), candle(1)])
    service.start(1)

    assert service.reset()["status"] == "ended"
    assert service.state()["index"] == 1


def test_restore_rejects_start_index_ahead_of_current_cursor():
    service = ReplayService()
    service.load([candle(0), candle(1), candle(2)])
    service.start(0)
    state = service.export_state()
    state["startIndex"] = 2

    with pytest.raises(ValueError, match="replay start index cannot exceed current index"):
        ReplayService.from_state(state)
