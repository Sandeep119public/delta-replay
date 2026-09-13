from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def headers():
    return {"X-Session-ID": str(uuid4())}


def test_health_contract():
    response = client.get("/health/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_session_header_is_required():
    response = client.get("/api/v1/trading/state")
    assert response.status_code == 400
    assert "X-Session-ID" in response.json()["detail"]


def test_session_header_must_be_uuid():
    response = client.get("/api/v1/trading/state", headers={"X-Session-ID": "not-a-uuid"})
    assert response.status_code == 400
    assert "valid UUID" in response.json()["detail"]


def test_invalid_order_price_contract_is_rejected():
    response = client.post(
        "/api/v1/trading/order",
        headers=headers(),
        json={
            "symbol": "BTCUSDT",
            "side": "buy",
            "quantity": 1,
            "type": "market",
            "limitPrice": 100,
        },
    )
    assert response.status_code == 422


def test_invalid_fee_rate_is_rejected():
    response = client.post(
        "/api/v1/trading/account/fee-rate",
        headers=headers(),
        json={"rate": 1},
    )
    assert response.status_code == 422


def test_oversized_csv_is_rejected():
    response = client.post(
        "/api/v1/data/csv",
        headers=headers(),
        files={"file": ("large.csv", b"x" * (10 * 1024 * 1024 + 1), "text/csv")},
    )
    assert response.status_code == 413


def test_replay_load_and_state_are_session_scoped():
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


def test_replay_seek_is_blocked_after_trade_activity():
    session = headers()
    payload = {
        "candles": [
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100},
            {"time": 2, "open": 101, "high": 102, "low": 100, "close": 101},
        ]
    }
    assert client.post("/api/v1/replay/load", headers=session, json=payload).status_code == 200
    assert client.post("/api/v1/replay/step", headers=session).status_code == 200
    order = client.post(
        "/api/v1/trading/order",
        headers=session,
        json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1},
    )
    assert order.status_code == 200
    assert client.post("/api/v1/replay/step", headers=session).status_code == 200
    seek = client.post("/api/v1/replay/seek/0", headers=session)
    assert seek.status_code == 409
