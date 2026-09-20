import pytest

from app.services.replay_timeline import ReplayDivergenceError, ReplayTimeline


def event(kind, index, payload=None):
    return {
        "type": kind,
        "replayIndex": index,
        "payload": payload or {"symbol": "BTCUSDT"},
    }


def test_timeline_record_truncates_future_before_appending():
    timeline = ReplayTimeline([
        event("market_step", 0),
        event("market_step", 1),
        event("market_step", 2),
    ])

    timeline.record("order", 1, {"symbol": "BTCUSDT", "side": "buy", "quantity": 1})

    assert [item["replayIndex"] for item in timeline] == [0, 1, 1]
    assert timeline.snapshot()[-1]["type"] == "order"
    assert all(item["replayIndex"] <= 1 for item in timeline)


def test_timeline_rejects_invalid_event_order_on_record():
    timeline = ReplayTimeline([event("market_step", 0)])

    with pytest.raises(ReplayDivergenceError, match="multiple market context"):
        timeline.record("market_step", 0, {"symbol": "BTCUSDT"})


def test_timeline_snapshots_are_defensive():
    timeline = ReplayTimeline([event("market_step", 0)])
    snapshot = timeline.snapshot()
    snapshot[0]["payload"]["symbol"] = "ETHUSDT"

    assert timeline.snapshot()[0]["payload"]["symbol"] == "BTCUSDT"


def test_timeline_replace_validates_before_commit():
    timeline = ReplayTimeline([event("market_step", 0)])

    with pytest.raises(ReplayDivergenceError, match="not ordered"):
        timeline.replace([event("market_step", 1), event("market_step", 0)])

    assert timeline.snapshot() == [event("market_step", 0)]


def test_session_history_is_a_projection_of_timeline():
    from app.services.session_manager import SessionState

    session = SessionState()
    session.record("market_step", 0, {"symbol": "BTCUSDT"})

    history = session.history
    history.append(event("market_step", 1))

    assert len(session.timeline) == 1
    assert len(session.history) == 1

    session.history = [event("market_step", 0), event("market_step", 1)]
    assert len(session.timeline) == 2
