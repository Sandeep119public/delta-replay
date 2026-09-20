import pytest

from app.services.replay_session import ReplaySession
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
    session = ReplaySession()
    session.record("market_step", 0, {"symbol": "BTCUSDT"})

    history = session.history
    history.append(event("market_step", 1))

    assert len(session.timeline) == 1
    assert len(session.history) == 1

    session.replace_history([event("market_step", 0), event("market_step", 1)])
    assert len(session.timeline) == 2


def test_replay_session_replaces_trading_through_aggregate_boundary():
    session = ReplaySession()
    original = session.trading
    replacement = session.trading.__class__()

    session.replace_trading(replacement)

    assert session.trading is replacement
    assert session.trading is not original


def test_replay_session_rejects_invalid_trading_replacement():
    session = ReplaySession()

    with pytest.raises(TypeError, match="PaperTradingEngine"):
        session.replace_trading(object())


def test_timeline_owns_market_symbol_queries():
    timeline = ReplayTimeline([
        event("market_step", 0, {"symbol": "BTCUSDT"}),
        event("order", 0, {"symbol": "BTCUSDT", "side": "buy", "quantity": 1}),
        event("market_step", 1, {"symbol": "ETHUSDT"}),
        event("candle", 1, {"symbol": "SOLUSDT", "index": 1, "candle": {"open": 1, "high": 1, "low": 1, "close": 1}}),
    ])

    assert timeline.latest_replay_symbol() == "ETHUSDT"


def test_timeline_iteration_is_defensive():
    timeline = ReplayTimeline([event("market_step", 0)])

    next(iter(timeline))["payload"]["symbol"] = "ETHUSDT"

    assert timeline.snapshot()[0]["payload"]["symbol"] == "BTCUSDT"


def test_timeline_truncate_preserves_validated_ownership():
    timeline = ReplayTimeline([
        event("market_step", 0),
        event("market_step", 1),
    ])

    timeline.truncate_after(0)
    assert timeline.snapshot() == [event("market_step", 0)]

    snapshot = timeline.snapshot()
    snapshot[0]["payload"]["symbol"] = "ETHUSDT"
    assert timeline.snapshot() == [event("market_step", 0)]


def test_timeline_iteration_returns_a_fresh_snapshot_each_time():
    timeline = ReplayTimeline([event("market_step", 0)])

    first = next(iter(timeline))
    second = next(iter(timeline))

    assert first is not second
    assert first == second


def test_replay_session_load_and_start_own_mutation_and_history():
    session = ReplaySession()
    candles = [
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
        {"time": 2, "open": 100, "high": 102, "low": 98, "close": 101},
    ]

    session.load(candles)
    session.start(0, "BTCUSDT")

    assert session.replay.index == 0
    assert session.trading.index == 0
    assert session.history[0]["type"] == "market_step"


def test_replay_session_order_records_as_one_command():
    session = ReplaySession()
    session.load([
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
        {"time": 2, "open": 100, "high": 102, "low": 98, "close": 101},
    ])
    session.start(0, "BTCUSDT")

    order = session.submit_order("BTCUSDT", "buy", 1)

    assert order["status"] == "PENDING"
    assert [event["type"] for event in session.history] == ["market_step", "order"]


def test_replay_session_reconstruction_is_deterministic():
    candles = [
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
        {"time": 2, "open": 100, "high": 103, "low": 98, "close": 102},
        {"time": 3, "open": 102, "high": 104, "low": 101, "close": 103},
    ]

    first = ReplaySession()
    first.load(candles)
    first.start(0, "BTCUSDT")
    first.step("BTCUSDT")
    first.submit_order("BTCUSDT", "buy", 1)
    first.seek(2, "BTCUSDT")

    second = ReplaySession()
    second.load(candles)
    second.start(0, "BTCUSDT")
    second.step("BTCUSDT")
    second.submit_order("BTCUSDT", "buy", 1)
    second.seek(2, "BTCUSDT")

    assert first.replay.export_state() == second.replay.export_state()
    assert first.trading.export_state() == second.trading.export_state()
    assert first.trading.export_market_state() == second.trading.export_market_state()
    assert first.history == second.history


def test_replay_session_owns_risk_clear_command_and_rebuilds_it():
    session = ReplaySession()
    session.load([
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
        {"time": 2, "open": 100, "high": 102, "low": 98, "close": 101},
    ])
    session.start(0, "BTCUSDT")
    session.submit_order("BTCUSDT", "buy", 1)
    session.step("BTCUSDT")
    session.set_risk("BTCUSDT", 95, 110)

    session.clear_risk("BTCUSDT", "stopLoss")

    assert session.trading.positions["BTCUSDT"]["stop_loss"] is None
    assert session.trading.positions["BTCUSDT"]["take_profit"] == 110
    assert session.history[-1]["type"] == "clear_risk"
    session.seek(1, "BTCUSDT")
    assert session.trading.positions["BTCUSDT"]["stop_loss"] is None
