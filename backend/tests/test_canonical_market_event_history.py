from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import ReplayDivergenceError, rebuild_trading


client = TestClient(app)


def candle(time, price, volume=1):
    return {"time": time, "open": price, "high": price + 2, "low": price - 2, "close": price + 1, "volume": volume}


def replay():
    service = ReplayService()
    service.load([candle(1, 100), candle(2, 102), candle(3, 104)])
    service.start(0)
    return service


def test_engine_attaches_new_symbol_without_advancing_or_reprocessing():
    engine = PaperTradingEngine()
    engine.on_candle(candle(1, 100), 0, "BTCUSDT")
    engine.submit("ETHUSDT", "buy", 1)

    events = engine.on_candle(candle(1, 200), 0, "ETHUSDT")

    assert events == []
    assert engine.index == 0
    assert engine.get_latest_market("BTCUSDT")["candle"] == candle(1, 100)
    assert engine.get_latest_market("ETHUSDT")["candle"] == candle(1, 200)
    assert engine.orders[1]["status"] == "PENDING"
    assert not engine.positions


def test_engine_same_index_retry_is_exactly_idempotent():
    engine = PaperTradingEngine()
    engine.on_candle(candle(1, 100), 0, "BTCUSDT")
    engine.mark("BTCUSDT", 101)
    before = engine.export_market_state()

    assert engine.on_candle(candle(1, 100), 0, "BTCUSDT") == []
    assert engine.export_market_state() == before


def test_engine_rejects_any_same_index_candle_change():
    engine = PaperTradingEngine()
    original = candle(1, 100, volume=1)
    engine.on_candle(original, 0, "BTCUSDT")

    changed = candle(1, 100, volume=2)
    with pytest.raises(ValueError, match="same-index candle"):
        engine.on_candle(changed, 0, "BTCUSDT")


def test_engine_set_market_context_cannot_overwrite_same_index_symbol():
    engine = PaperTradingEngine()
    engine.on_candle(candle(1, 100), 0, "BTCUSDT")

    with pytest.raises(ValueError, match="same-index candle"):
        engine.set_market_context("BTCUSDT", candle(1, 101), 0)


def test_rebuild_supports_multiple_symbol_contexts_at_one_index():
    service = replay()
    eth = candle(1, 200)
    history = [
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
        {"type": "candle", "replayIndex": 0, "payload": {"candle": eth, "index": 0, "symbol": "ETHUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "ETHUSDT", "side": "buy", "quantity": 1, "type": "market", "limitPrice": None, "stopPrice": None}},
        {"type": "candle", "replayIndex": 1, "payload": {"candle": candle(2, 202), "index": 1, "symbol": "ETHUSDT"}},
    ]

    rebuilt = rebuild_trading(service, history, 1)

    assert rebuilt.index == 1
    assert rebuilt.get_latest_market("BTCUSDT")["candle"] == service.candles[0]
    assert rebuilt.get_latest_market("ETHUSDT")["candle"] == candle(2, 202)
    assert rebuilt.positions["ETHUSDT"]["entry_price"] == 202


def test_rebuild_allows_explicit_candle_to_establish_timeline():
    service = replay()
    eth = candle(1, 200)
    history = [
        {"type": "candle", "replayIndex": 0, "payload": {"candle": eth, "index": 0, "symbol": "ETHUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "ETHUSDT", "side": "buy", "quantity": 1, "type": "market", "limitPrice": None, "stopPrice": None}},
    ]

    rebuilt = rebuild_trading(service, history, 0)

    assert rebuilt.index == 0
    assert rebuilt.get_latest_market("ETHUSDT")["candle"] == eth
    assert rebuilt.orders[1]["status"] == "PENDING"
    assert rebuilt.positions == {}


def test_rebuild_rejects_duplicate_symbol_context_at_one_index():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
        {"type": "candle", "replayIndex": 0, "payload": {"candle": service.candles[0], "index": 0, "symbol": "ETHUSDT"}},
        {"type": "candle", "replayIndex": 0, "payload": {"candle": candle(1, 200), "index": 0, "symbol": "ETHUSDT"}},
    ]

    with pytest.raises(ReplayDivergenceError, match="multiple market context"):
        rebuild_trading(service, history, 0)


def test_rebuild_rejects_market_context_after_trading_command():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market", "limitPrice": None, "stopPrice": None}},
        {"type": "candle", "replayIndex": 0, "payload": {"candle": candle(1, 200), "index": 0, "symbol": "ETHUSDT"}},
    ]

    with pytest.raises(ReplayDivergenceError, match="must precede trading commands"):
        rebuild_trading(service, history, 0)


def test_rebuild_rejects_market_step_after_non_market_command():
    service = replay()
    history = [
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market", "limitPrice": None, "stopPrice": None}},
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
    ]

    with pytest.raises(ReplayDivergenceError, match="must precede trading commands"):
        rebuild_trading(service, history, 0)


def test_rebuild_rejects_market_step_after_candle_for_same_index():
    service = replay()
    history = [
        {"type": "candle", "replayIndex": 0, "payload": {"candle": candle(1, 200), "index": 0, "symbol": "ETHUSDT"}},
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
    ]

    with pytest.raises(ReplayDivergenceError, match="must follow the timeline event|must be first"):
        rebuild_trading(service, history, 0)


def test_manual_candle_attaches_new_symbol_at_current_replay_index():
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}
    payload = {"candles": [candle(1, 100), candle(2, 102)]}

    try:
        assert client.post("/api/v1/replay/load", headers=headers, json=payload).status_code == 200
        started = client.post("/api/v1/replay/start/0", headers=headers, params={"symbol": "BTCUSDT"})
        assert started.status_code == 200

        response = client.post(
            "/api/v1/trading/candle",
            headers=headers,
            json={"symbol": "ETHUSDT", "candle": candle(1, 200), "index": 0},
        )

        assert response.status_code == 200
        assert response.json()["index"] == 0
        assert response.json()["positions"] == []
    finally:
        from app.services.session_manager import manager
        manager.delete(session_id)


def test_supplemental_symbol_does_not_replace_primary_replay_symbol():
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}
    payload = {"candles": [candle(1, 100), candle(2, 102), candle(3, 104)]}

    try:
        assert client.post("/api/v1/replay/load", headers=headers, json=payload).status_code == 200
        assert client.post("/api/v1/replay/start/0", headers=headers, params={"symbol": "BTCUSDT"}).status_code == 200
        supplemental = client.post(
            "/api/v1/trading/candle",
            headers=headers,
            json={"symbol": "ETHUSDT", "candle": candle(1, 200), "index": 0},
        )
        assert supplemental.status_code == 200

        reset = client.post("/api/v1/replay/reset", headers=headers)
        assert reset.status_code == 200
        assert reset.json()["trading"]["index"] == 0
        assert reset.json()["trading"]["positions"] == []
        assert reset.json()["candle"] == candle(1, 100)

        stepped = client.post("/api/v1/replay/step", headers=headers)
        assert stepped.status_code == 200
        assert stepped.json()["candle"] == candle(2, 102)
        assert stepped.json()["trading"]["index"] == 1
        assert stepped.json()["trading"]["positions"] == []
    finally:
        from app.services.session_manager import manager
        manager.delete(session_id)


def test_trading_reset_preserves_primary_replay_symbol_after_supplemental_event():
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}
    payload = {"candles": [candle(1, 100), candle(2, 102), candle(3, 104)]}

    try:
        assert client.post("/api/v1/replay/load", headers=headers, json=payload).status_code == 200
        assert client.post("/api/v1/replay/start/0", headers=headers, params={"symbol": "BTCUSDT"}).status_code == 200
        supplemental = client.post(
            "/api/v1/trading/candle",
            headers=headers,
            json={"symbol": "ETHUSDT", "candle": candle(1, 200), "index": 0},
        )
        assert supplemental.status_code == 200

        reset = client.post("/api/v1/trading/reset", headers=headers)
        assert reset.status_code == 200
        trading = reset.json()
        assert trading["index"] == 0
        assert trading["positions"] == []

        stepped = client.post("/api/v1/replay/step", headers=headers)
        assert stepped.status_code == 200
        assert stepped.json()["candle"] == candle(2, 102)
        assert stepped.json()["trading"]["index"] == 1
    finally:
        from app.services.session_manager import manager
        manager.delete(session_id)


def test_manual_candle_same_symbol_retry_does_not_duplicate_history():
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}
    payload = {"candles": [candle(1, 100), candle(2, 102)]}

    try:
        assert client.post("/api/v1/replay/load", headers=headers, json=payload).status_code == 200
        assert client.post("/api/v1/replay/start/0", headers=headers, params={"symbol": "BTCUSDT"}).status_code == 200
        first = client.post("/api/v1/trading/candle", headers=headers, json={"symbol": "ETHUSDT", "candle": candle(1, 200), "index": 0})
        assert first.status_code == 200
        second = client.post("/api/v1/trading/candle", headers=headers, json={"symbol": "ETHUSDT", "candle": candle(1, 200), "index": 0})
        assert second.status_code == 200

        from app.services.session_manager import manager
        history = manager.get(session_id).history
        assert sum(1 for event in history if event["type"] == "candle" and event["payload"]["symbol"] == "ETHUSDT") == 1
    finally:
        from app.services.session_manager import manager
        manager.delete(session_id)
