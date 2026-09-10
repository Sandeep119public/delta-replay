from math import nan
from uuid import uuid4

import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_manager import SessionManager
from app.services.session_repository import InMemorySessionRepository
from app.services.session_state import SESSION_STATE_VERSION, restore_session, serialize_session


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def test_session_round_trip_preserves_replay_and_trading_state():
    replay = ReplayService()
    replay.load([
        candle(100, 105, 95, 102, 1),
        candle(102, 108, 101, 107, 2),
        candle(107, 110, 104, 109, 3),
    ])
    replay.start(1)
    replay.speed = 4
    replay.step()

    trading = PaperTradingEngine(starting_balance=25000, fee_rate=0.001, margin_rate=0.2, maint_margin_rate=0.07)
    trading.on_candle(replay.candles[0], 0, "BTCUSDT")
    order = trading.submit("BTCUSDT", "buy", 2, "limit", limit_price=101)
    trading.on_candle(replay.candles[1], 1, "BTCUSDT")
    trading.set_risk("BTCUSDT", stop_loss=96, take_profit=115)
    second_order = trading.submit("ETHUSDT", "sell", 1, "stop_market", stop_price=90)

    document = serialize_session(replay, trading)
    restored_replay, restored_trading = restore_session(document)

    assert document["version"] == SESSION_STATE_VERSION
    assert restored_replay.export_state() == replay.export_state()
    assert restored_trading.export_state() == trading.export_state()
    assert restored_trading.orders[order["id"]]["status"] == "FILLED"
    assert restored_trading.orders[second_order["id"]]["status"] == "PENDING"
    assert restored_trading.positions["BTCUSDT"]["stop_loss"] == 96
    assert restored_trading.positions["BTCUSDT"]["take_profit"] == 115

    next_order = restored_trading.submit("ETHUSDT", "buy", 0.5)
    assert next_order["id"] > second_order["id"]


def test_zero_fee_open_position_round_trips_through_persistence():
    trading = PaperTradingEngine(fee_rate=0)
    trading.on_candle(candle(100, 101, 99, 100), 0, "BTCUSDT")
    trading.submit("BTCUSDT", "buy", 1)
    trading.on_candle(candle(100, 102, 99, 101), 1, "BTCUSDT")

    document = trading.export_state()
    restored = PaperTradingEngine.from_state(document)

    assert restored.fee_rate == 0
    assert restored.positions["BTCUSDT"]["entry_fee"] == 0
    assert restored.export_state() == document


def test_replay_persistence_preserves_fractional_speed():
    replay = ReplayService()
    replay.load([candle(100, 105, 95, 102)])
    replay.start(0)
    replay.speed = 2.5

    restored = ReplayService.from_state(replay.export_state())

    assert restored.speed == 2.5
    assert restored.export_state() == replay.export_state()


def test_replay_rejects_fractional_indices():
    replay = ReplayService()
    replay.load([candle(100, 105, 95, 102)])

    with pytest.raises(ValueError, match="integer"):
        replay.start(0.5)
    with pytest.raises(ValueError, match="integer"):
        replay.seek(0.5)


def test_replay_state_is_defensively_copied():
    replay = ReplayService()
    replay.load([candle(100, 105, 95, 102), candle(102, 106, 101, 104, 2)])
    replay.start(0)

    state = replay.state()
    state["candle"]["close"] = 999
    state["visibleCandles"][0]["open"] = 999

    fresh = replay.state()
    assert fresh["candle"]["close"] == 102
    assert fresh["visibleCandles"][0]["open"] == 100


def test_manager_rehydrates_from_repository_after_cache_loss():
    repository = InMemorySessionRepository()
    first_manager = SessionManager(repository)
    session_id = str(uuid4())

    first_manager.get(session_id)

    def prepare(state):
        state.replay.load([candle(100, 105, 95, 102), candle(102, 106, 101, 104, 2)])
        state.replay.start(0)
        state.trading.on_candle(state.replay.candles[0], 0, "BTCUSDT")
        state.trading.submit("BTCUSDT", "buy", 1)
        return state.trading.export_state()

    first_manager.atomic(session_id, prepare)
    first_manager.clear_cache()
    restored = first_manager.get(session_id)

    assert restored.replay.state()["index"] == 0
    assert restored.trading.export_state()["orders"]


def test_atomic_mutation_rolls_back_after_operation_failure():
    repository = InMemorySessionRepository()
    manager = SessionManager(repository)
    session_id = str(uuid4())
    manager.get(session_id)

    with pytest.raises(RuntimeError, match="simulated crash"):
        def fail_after_mutation(state):
            state.replay.speed = 9
            state.replay.load([candle(100, 101, 99, 100)])
            raise RuntimeError("simulated crash")

        manager.atomic(session_id, fail_after_mutation)

    manager.clear_cache()
    restored = manager.get(session_id)
    assert restored.replay.speed == 1
    assert restored.replay.state()["total"] == 0
    assert restored.replay.state()["status"] == "idle"


def test_repository_defensively_copies_documents():
    repository = InMemorySessionRepository()
    session_id = str(uuid4())
    document = {"version": 1, "replay": {"candles": []}, "trading": {"positions": {}}}

    repository.save(session_id, document)
    document["replay"]["candles"].append({"close": 10})
    loaded = repository.get(session_id)

    assert loaded["replay"]["candles"] == []


def test_restore_rejects_unknown_version():
    with pytest.raises(ValueError, match="unsupported session state version"):
        restore_session({"version": 99, "replay": {}, "trading": {}})


def test_restore_rejects_malformed_trading_state():
    with pytest.raises(ValueError, match="trading state missing fields"):
        restore_session({
            "version": SESSION_STATE_VERSION,
            "replay": {"candles": [], "index": -1, "startIndex": -1, "speed": 1, "status": "idle"},
            "trading": {},
        })


def test_restore_rejects_non_finite_persisted_numbers():
    replay = ReplayService()
    trading = PaperTradingEngine()
    document = serialize_session(replay, trading)
    document["trading"]["account"]["walletBalance"] = nan

    with pytest.raises(ValueError, match="JSON-safe"):
        restore_session(document)


def test_restore_rejects_inconsistent_replay_lifecycle_state():
    base = {
        "version": SESSION_STATE_VERSION,
        "replay": {
            "candles": [candle(100, 105, 95, 102)],
            "index": 0,
            "startIndex": 0,
            "speed": 1,
            "status": "ready",
        },
        "trading": serialize_session(ReplayService(), PaperTradingEngine())["trading"],
    }

    with pytest.raises(ValueError, match="ready replay"):
        restore_session(base)

    base["replay"]["status"] = "paused"
    base["replay"]["startIndex"] = -1
    with pytest.raises(ValueError, match="active indices"):
        restore_session(base)


def test_session_manager_delete_removes_persisted_state():
    repository = InMemorySessionRepository()
    session_id = str(uuid4())
    manager = SessionManager(repository)
    manager.get(session_id)

    manager.delete(session_id)
    manager.clear_cache()

    fresh = manager.get(session_id)
    assert fresh.replay.state()["status"] == "idle"
    assert fresh.trading.index == -1


def test_delete_keeps_session_lock_identity_for_future_operations():
    repository = InMemorySessionRepository()
    manager = SessionManager(repository)
    session_id = str(uuid4())

    first_lock = manager._lock_for(session_id)
    manager.get(session_id)
    manager.delete(session_id)

    assert manager._lock_for(session_id) is first_lock
