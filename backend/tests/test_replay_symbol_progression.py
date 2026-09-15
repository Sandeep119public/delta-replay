from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.session_manager import manager


def candles():
    return {
        "candles": [
            {"time": 1, "open": 100, "high": 105, "low": 95, "close": 102, "volume": 1},
            {"time": 2, "open": 102, "high": 110, "low": 101, "close": 109, "volume": 1},
            {"time": 3, "open": 109, "high": 115, "low": 108, "close": 112, "volume": 1},
        ]
    }


def test_omitted_step_uses_latest_explicit_symbol_after_symbol_change():
    client = TestClient(app)
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}

    client.post("/api/v1/replay/load", json=candles(), headers=headers)
    started = client.post("/api/v1/replay/start/0", params={"symbol": "BTCUSDT"}, headers=headers)
    assert started.status_code == 200

    switched = client.post("/api/v1/replay/step", params={"symbol": "ETHUSDT"}, headers=headers)
    assert switched.status_code == 200

    continued = client.post("/api/v1/replay/step", headers=headers)
    assert continued.status_code == 200
    assert continued.json()["trading"]["index"] == 2
    assert continued.json()["trading"]["marketContext"]["ETHUSDT"]["index"] == 2

    manager.delete(session_id)
