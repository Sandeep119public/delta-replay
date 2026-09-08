from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.session_manager import manager


def candles():
    return {"candles": [
        {"time": 1, "open": 100, "high": 105, "low": 95, "close": 102, "volume": 1},
        {"time": 2, "open": 102, "high": 110, "low": 101, "close": 109, "volume": 1},
    ]}


def test_replay_step_atomically_processes_trading():
    client = TestClient(app)
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}

    client.post("/api/v1/replay/load", json=candles(), headers=headers)
    client.post("/api/v1/replay/start/0", headers=headers)
    client.post("/api/v1/trading/order", json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1}, headers=headers)

    response = client.post("/api/v1/replay/step", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["index"] == 1
    assert body["candle"]["open"] == 102
    assert body["trading"]["positions"][0]["symbol"] == "BTCUSDT"
    assert body["trading"]["positions"][0]["entry_price"] == 102

    manager.delete(session_id)


def test_replay_step_rolls_back_cursor_when_trading_raises(monkeypatch):
    client = TestClient(app)
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}

    client.post("/api/v1/replay/load", json=candles(), headers=headers)
    client.post("/api/v1/replay/start/0", headers=headers)

    from app.services.paper_engine import PaperTradingEngine

    def explode(*args, **kwargs):
        raise RuntimeError("forced trading failure")

    monkeypatch.setattr(PaperTradingEngine, "on_candle", explode)
    with pytest.raises(RuntimeError, match="forced trading failure"):
        client.post("/api/v1/replay/step", headers=headers)

    state = client.get("/api/v1/replay/state", headers=headers)
    assert state.status_code == 200
    assert state.json()["index"] == 0
    manager.delete(session_id)
