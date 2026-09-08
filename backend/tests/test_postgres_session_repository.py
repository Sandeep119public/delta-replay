import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.postgres_session_repository import PostgresSessionRepository
from app.services.replay_service import ReplayService
from app.services.session_manager import SessionManager
from app.services.session_state import serialize_session


pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL is not configured",
)


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def test_postgres_round_trip_and_revisioning():
    repository = PostgresSessionRepository(os.environ["DATABASE_URL"])
    session_id = str(uuid4())
    replay = ReplayService()
    replay.load([candle(100, 105, 95, 102)])
    replay.start(0)
    trading = PaperTradingEngine(starting_balance=25000)
    document = serialize_session(replay, trading)

    try:
        repository.save(session_id, document)
        first = repository.get(session_id)
        assert first is not None
        assert first["version"] == document["version"]
        assert first["revision"] == 1

        second = dict(document)
        second["replay"] = dict(second["replay"])
        second["replay"]["speed"] = 4
        revision = repository.save_if_revision(session_id, second, 1)
        assert revision == 2
        assert repository.get(session_id)["replay"]["speed"] == 4

        with pytest.raises(RuntimeError, match="revision conflict"):
            repository.save_if_revision(session_id, document, 1)
    finally:
        repository.delete(session_id)


def test_postgres_manager_rehydrates_after_cache_loss():
    repository = PostgresSessionRepository(os.environ["DATABASE_URL"])
    first_manager = SessionManager(repository)
    second_manager = SessionManager(repository)
    session_id = str(uuid4())

    try:
        first_manager.get(session_id)

        def prepare(state):
            state.replay.load([candle(100, 105, 95, 102), candle(102, 106, 101, 104, 2)])
            state.replay.start(0)
            state.trading.on_candle(state.replay.candles[0], 0, "BTCUSDT")
            return state.trading.submit("BTCUSDT", "buy", 1)

        pending = first_manager.atomic(session_id, prepare)
        restored = second_manager.get(session_id)
        assert restored.replay.state()["index"] == 0
        assert restored.trading.orders[pending["id"]]["status"] == "PENDING"
    finally:
        repository.delete(session_id)


def test_postgres_atomic_update_rolls_back_after_operation_failure():
    repository = PostgresSessionRepository(os.environ["DATABASE_URL"])
    manager = SessionManager(repository)
    session_id = str(uuid4())

    try:
        manager.get(session_id)
        with pytest.raises(RuntimeError, match="simulated crash"):
            def fail_after_mutation(state):
                state.replay.speed = 7
                state.replay.load([candle(100, 101, 99, 100)])
                raise RuntimeError("simulated crash")

            manager.atomic(session_id, fail_after_mutation)

        manager.clear_cache()
        restored = manager.get(session_id)
        assert restored.replay.speed == 1
        assert restored.replay.state()["total"] == 0
        assert restored.replay.state()["status"] == "idle"
    finally:
        repository.delete(session_id)


def test_postgres_atomic_updates_serialize_concurrent_managers():
    repository = PostgresSessionRepository(os.environ["DATABASE_URL"])
    first_manager = SessionManager(repository)
    second_manager = SessionManager(repository)
    session_id = str(uuid4())
    first_manager.get(session_id)

    def increment(manager):
        return manager.atomic(session_id, lambda state: setattr(state.replay, "speed", state.replay.speed + 1) or state.replay.speed)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda item: increment(item), [first_manager, second_manager]))
        assert sorted(results) == [2, 3]
        final = first_manager.get(session_id)
        assert final.replay.speed == 3
    finally:
        repository.delete(session_id)
