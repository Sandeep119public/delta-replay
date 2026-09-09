from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.session_manager import get_session

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
    stepped = client.post("/api/v1/replay/step", headers=h(session))
    assert stepped.status_code == 200
    body = stepped.json()
    assert body["candle"]["close"] == 110
    assert body["trading"]["positions"]
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


def test_reset_preserves_custom_trading_configuration():
    client = TestClient(app)
    session = uuid4()
    assert client.post("/api/v1/trading/account/fee-rate", headers=h(session), json={"rate": 0.002}).status_code == 200

    service = get_session(type("Request", (), {"headers": h(session)})())
    service.trading.margin_rate = 0.2
    service.trading.maint_margin_rate = 0.08

    response = client.post("/api/v1/trading/reset", headers=h(session))
    assert response.status_code == 200
    fresh = get_session(type("Request", (), {"headers": h(session)})()).trading
    assert fresh.fee_rate == 0.002
    assert fresh.margin_rate == 0.2
    assert fresh.maint_margin_rate == 0.08


def test_market_candle_rejects_fractional_index():
    client = TestClient(app)
    session = uuid4()
    response = client.post(
        "/api/v1/trading/candle",
        headers=h(session),
        json={"symbol": "BTCUSDT", "candle": CANDLES[0], "index": 1.5},
    )
    assert response.status_code == 422
