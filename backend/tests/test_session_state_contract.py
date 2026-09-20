from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_session import ReplaySession
from app.services.session_state import restore_replay_session, serialize_replay_session


def sample_session():
    session = ReplaySession()
    session.load([
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
        {"time": 2, "open": 100, "high": 102, "low": 98, "close": 101},
    ])
    session.start(0, "BTCUSDT")
    return session


def test_session_codec_round_trips_aggregate_and_identity():
    session = sample_session()
    document = serialize_replay_session(session)

    restored = restore_replay_session(document)

    assert document["version"] == 3
    assert document["simulation"]["executionModel"] == "NEXT_BAR_OPEN_WITH_OHLC_GAPS"
    assert document["simulationId"]
    assert restored.history == session.history
    assert restored.replay.state() == session.replay.state()
    assert restored.trading.snapshot() == session.trading.snapshot()


def test_session_identity_rejects_history_tampering():
    session = sample_session()
    document = serialize_replay_session(session)
    document["history"].append({"type": "capital", "replayIndex": -1, "payload": {"balance": 9000}})

    try:
        restore_replay_session(document)
    except ValueError as exc:
        assert "simulation identity" in str(exc)
    else:
        raise AssertionError("tampered simulation identity was accepted")


def test_simulation_identity_changes_with_session_history():
    session = sample_session()
    first = serialize_replay_session(session)["simulationId"]
    session.submit_order("BTCUSDT", "buy", 1)
    assert serialize_replay_session(session)["simulationId"] != first
