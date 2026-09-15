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


def test_empty_cancel_all_does_not_create_replay_command():
    client = TestClient(app)
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}

    client.post("/api/v1/replay/load", json=candles(), headers=headers)
    client.post("/api/v1/replay/start/0", headers=headers)
    client.post("/api/v1/replay/step", headers=headers)

    cancelled = client.post("/api/v1/trading/orders/cancel-all", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["orders"] == []

    seek = client.post("/api/v1/replay/seek/2", headers=headers)
    assert seek.status_code == 200
    assert seek.json()["index"] == 2

    manager.delete(session_id)
