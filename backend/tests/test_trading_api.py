from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

CANDLES = [
    {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
    {"time": 2, "open": 100, "high": 120, "low": 80, "close": 110, "volume": 1},
    {"time": 3, "open": 110, "high": 130, "low": 90, "close": 120, "volume": 1},
]


def h(session):
    return {"X-Session-ID": str(session)}


def test_full_lifecycle():
    client = TestClient(app)
    session = uuid4()
    assert client.post("/api/v1/replay/load", headers=h(session), json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=h(session)).status_code == 200
    assert client.post("/api/v1/trading/order", headers=h(session), json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market"}).status_code == 200
    assert client.post("/api/v1/replay/step", headers=h(session)).status_code == 200
    candle = client.post("/api/v1/trading/candle", headers=h(session)).json()
    assert candle["candle"]["close"] == 110
    assert client.get("/api/v1/trading/state", headers=h(session)).json()["positions"]
    assert client.post("/api/v1/trading/risk", headers=h(session), json={"symbol": "BTCUSDT", "stopLoss": 95, "takeProfit": 125}).status_code == 200


def test_sessions_are_isolated():
    client = TestClient(app)
    first, second = uuid4(), uuid4()
    assert client.post("/api/v1/replay/load", headers=h(first), json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/1", headers=h(first)).status_code == 200
    assert client.get("/api/v1/replay/state", headers=h(first)).json()["index"] == 1
    other = client.get("/api/v1/replay/state", headers=h(second)).json()
    assert other["status"] == "idle" and other["total"] == 0


def test_session_header_is_required():
    client = TestClient(app)
    assert client.get("/api/v1/trading/state").status_code == 400
    assert client.get("/api/v1/trading/state", headers={"X-Session-ID": "bad"}).status_code == 400
