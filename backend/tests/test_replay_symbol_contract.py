import uuid

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_replay_step_uses_requested_symbol_for_trading_market_context():
    session_id = str(uuid.uuid4())
    headers = {"X-Session-ID": session_id}
    candles = [
        {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
        {"time": 2, "open": 110, "high": 111, "low": 109, "close": 110, "volume": 1},
    ]

    response = client.post("/api/v1/replay/load", json={"candles": candles}, headers=headers)
    assert response.status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=headers).status_code == 200

    assert client.post(
        "/api/v1/trading/order",
        json={"symbol": "ETHUSDT", "side": "buy", "quantity": 1},
        headers=headers,
    ).status_code == 200

    response = client.post("/api/v1/replay/step?symbol=ETHUSDT", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["trading"]["positions"][0]["symbol"] == "ETHUSDT"
    assert body["trading"]["positions"][0]["entry_price"] == 110
