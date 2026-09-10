import pytest

from app.services.replay_service import ReplayService


def candles():
    return [
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
        {"time": 2, "open": 101, "high": 102, "low": 100, "close": 101, "volume": 1},
        {"time": 3, "open": 102, "high": 103, "low": 101, "close": 102, "volume": 1},
    ]


def test_start_does_not_implicitly_process_a_second_candle():
    replay = ReplayService()
    replay.load(candles())
    state = replay.start(1)
    assert state["index"] == 1
    assert state["candle"]["time"] == 2
    assert state["visibleCandles"][-1]["time"] == 2


def test_step_is_idempotent_at_end():
    replay = ReplayService()
    replay.load(candles())
    replay.start(2)
    first = replay.step()
    second = replay.step()
    assert first == second
    assert second["index"] == 2
    assert second["status"] == "ended"


def test_seek_and_reset_are_deterministic():
    replay = ReplayService()
    replay.load(candles())
    replay.start(0)
    replay.seek(2)
    reset = replay.reset()
    assert reset["index"] == 0
    assert reset["startIndex"] == 0
    assert reset["status"] == "paused"


def test_from_state_rejects_invalid_timeline():
    replay = ReplayService()
    replay.load(candles())
    state = replay.export_state()
    state["index"] = 3
    with pytest.raises(ValueError, match="outside candle range"):
        ReplayService.from_state(state)
