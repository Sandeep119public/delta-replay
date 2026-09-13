import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def headers(session="test-session"):
    return {"X-Session-ID": session}


# The endpoint contract intentionally uses a separate function-local client/session.


def test_replay_load_requires_valid_candles():
    session = headers()
    response = client.post(
        "/api/v1/replay/load",
        headers=session,
        json={"candles": [{"time": 2, "open": 1, "high": 2, "low": 1, "close": 1}]},
    )
    assert response.status_code == 200


def test_replay_state_after_load_is_ready_and_unstarted():
    session = headers()
    payload = {
        "candles": [
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
            {"time": 2, "open": 101, "high": 102, "low": 100, "close": 101},
        ]
    }
    loaded = client.post("/api/v1/replay/load", headers=session, json=payload)
    assert loaded.status_code == 200
    assert loaded.json()["index"] == -1
    state = client.get("/api/v1/replay/state", headers=session)
    assert state.status_code == 200
    assert state.json()["index"] == -1


def test_replay_seek_reconstructs_trading_state_after_activity():
    session = headers("seek-reconstruction")
    payload = {
        "candles": [
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
            {"time": 2, "open": 101, "high": 102, "low": 100, "close": 101},
            {"time": 3, "open": 102, "high": 103, "low": 101, "close": 102},
        ]
    }
    assert client.post("/api/v1/replay/load", headers=session, json=payload).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=session).status_code == 200
    assert client.post("/api/v1/replay/step", headers=session).status_code == 200
    order = client.post(
        "/api/v1/trading/order",
        headers=session,
        json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1},
    )
    assert order.status_code == 200
    assert client.get("/api/v1/trading/state", headers=session).json()["pendingOrders"]
    assert client.post("/api/v1/replay/step", headers=session).status_code == 200
    assert client.get("/api/v1/trading/state", headers=session).json()["positions"]

    seek = client.post("/api/v1/replay/seek/0", headers=session)
    assert seek.status_code == 200
    rebuilt = seek.json()
    assert rebuilt["index"] == 0
    assert rebuilt["trading"]["positions"] == []
    assert len(rebuilt["trading"]["pendingOrders"]) == 1

    replayed = client.post("/api/v1/replay/step", headers=session)
    assert replayed.status_code == 200
    assert len(replayed.json()["trading"]["positions"]) == 1
