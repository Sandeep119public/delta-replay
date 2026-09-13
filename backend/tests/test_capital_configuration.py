from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


CANDLES = [
    {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
    {"time": 2, "open": 101, "high": 102, "low": 100, "close": 101, "volume": 1},
]


def headers(session):
    return {"X-Session-ID": str(session)}


def test_capital_configuration_is_persisted_as_pre_replay_command_and_rebuilds():
    client = TestClient(app)
    session = uuid4()
    h = headers(session)

    assert client.post("/api/v1/replay/load", headers=h, json={"candles": CANDLES}).status_code == 200
    response = client.post("/api/v1/trading/account/capital", headers=h, json={"balance": 25000})
    assert response.status_code == 200
    assert response.json()["account"]["startingBalance"] == 25000

    assert client.post("/api/v1/replay/start/0", headers=h).status_code == 200
    rebuilt = client.post("/api/v1/replay/seek/0", headers=h)
    assert rebuilt.status_code == 200
    assert rebuilt.json()["trading"]["account"]["startingBalance"] == 25000


def test_capital_cannot_change_after_trading_activity():
    client = TestClient(app)
    session = uuid4()
    h = headers(session)

    assert client.post("/api/v1/replay/load", headers=h, json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=h).status_code == 200
    response = client.post("/api/v1/trading/account/capital", headers=h, json={"balance": 25000})
    assert response.status_code == 422
