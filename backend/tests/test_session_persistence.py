from uuid import uuid4

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.session_manager import SessionManager, SessionState
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


def test_manager_rehydrates_from_repository_after_cache_loss():
    repository = InMemorySessionRepository()
    first_manager = SessionManager(repository)
    session_id = str(uuid4())
    state = first_manager.get(session_id)

    state.replay.load([candle(100, 105, 95, 102), candle(102, 106, 101, 104, 2)])
    state.replay.start(0)
    state.trading.on_candle(state.replay.candles[0], 0, "BTCUSDT")
    state.trading.submit("BTCUSDT", "buy", 1)
    first_manager.save(session_id, state)

    first_manager.clear_cache()
    restored = first_manager.get(session_id)

    assert restored.replay.state() == state.replay.state()
    assert restored.trading.export_state() == state.trading.export_state()


def test_repository_defensively_copies_documents():
    repository = InMemorySessionRepository()
    session_id = str(uuid4())
    document = {"version": 1, "replay": {"candles": []}, "trading": {"positions": {}}}

    repository.save(session_id, document)
    document["replay"]["candles"].append({"close": 10})
    loaded = repository.get(session_id)

    assert loaded["replay"]["candles"] == []


def test_restore_rejects_unknown_version():
    try:
        restore_session({"version": 99, "replay": {}, "trading": {}})
        assert False
    except ValueError as exc:
        assert "unsupported session state version" in str(exc)


def test_restore_rejects_malformed_replay_state():
    try:
        restore_session({
            "version": SESSION_STATE_VERSION,
            "replay": {"candles": [], "index": 0, "startIndex": -1, "speed": 1, "status": "ready"},
            "trading": {},
        })
        assert False
    except ValueError as exc:
        assert "trading state missing fields" in str(exc)


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
