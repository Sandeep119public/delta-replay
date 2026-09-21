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



def test_start_does_not_implicitly_process_a_second_candle():
    service = ReplayService()
    service.load([candle(0), candle(1), candle(2)])

    state = service.start(1)

    assert state["index"] == 1
    assert state["candle"]["time"] == 2
    assert state["visibleCandles"][-1]["time"] == 2


def test_step_is_idempotent_at_end():
    service = ReplayService()
    service.load([candle(0), candle(1)])
    service.start(1)

    first = service.step()
    second = service.step()

    assert first == second
    assert second["index"] == 1
    assert second["status"] == "ended"


def test_seek_and_reset_are_deterministic():
    service = ReplayService()
    service.load([candle(0), candle(1), candle(2)])
    service.start(0)
    service.seek(2)

    reset = service.reset()

    assert reset["index"] == 0
    assert reset["startIndex"] == 0
    assert reset["status"] == "paused"


def test_from_state_rejects_invalid_timeline_cursor():
    service = ReplayService()
    service.load([candle(0), candle(1), candle(2)])
    service.start(0)
    state = service.export_state()
    state["index"] = 3

    with pytest.raises(ValueError, match="outside candle range"):
        ReplayService.from_state(state)


def test_append_extends_replay_before_start_and_recomputes_dataset_identity():
    service = ReplayService()
    service.load([candle(0), candle(1)])

    state = service.append([candle(2), candle(3)])

    assert state["total"] == 4
    assert state["status"] == "ready"
    assert state["index"] == -1
    assert service.candles[-1]["time"] == 4


def test_append_rejects_out_of_order_chunks():
    service = ReplayService()
    service.load([candle(0), candle(1)])

    with pytest.raises(ValueError, match="start after the existing dataset"):
        service.append([candle(1), candle(2)])
