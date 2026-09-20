from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.session_manager import manager

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
    placed = client.post("/api/v1/trading/order", headers=h(session), json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market"})
    assert placed.status_code == 200
    assert placed.json()["order"]["createdIndex"] == 0
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


def test_trading_reset_reanchors_to_current_replay_timeline():
    client = TestClient(app)
    session = uuid4()
    candles = CANDLES + [
        {"time": 4, "open": 120, "high": 140, "low": 110, "close": 130, "volume": 1},
    ]
    headers = h(session)

    assert client.post("/api/v1/replay/load", headers=headers, json={"candles": candles}).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=headers).status_code == 200
    assert client.post("/api/v1/replay/step", headers=headers).status_code == 200
    assert client.post("/api/v1/replay/step", headers=headers).status_code == 200
    assert client.get("/api/v1/replay/state", headers=headers).json()["index"] == 2

    reset = client.post("/api/v1/trading/reset", headers=headers)

    assert reset.status_code == 200
    reset_body = reset.json()
    assert reset_body["index"] == 2
    assert reset_body["orders"] == []
    assert reset_body["positions"] == []
    trading = manager.get(str(session)).trading
    assert trading.index == 2
    history = manager.get(str(session)).history
    assert [event["type"] for event in history] == ["market_step", "market_step", "market_step"]
    assert [event["replayIndex"] for event in history] == [0, 1, 2]

    seek = client.post("/api/v1/replay/seek/1", headers=headers)
    assert seek.status_code == 200
    assert seek.json()["index"] == 1
    assert manager.get(str(session)).history[-1]["replayIndex"] == 1

    stepped_back_to_current = client.post("/api/v1/replay/step", headers=headers)
    assert stepped_back_to_current.status_code == 200
    assert stepped_back_to_current.json()["index"] == 2

    placed = client.post(
        "/api/v1/trading/order",
        headers=headers,
        json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market"},
    )
    assert placed.status_code == 200
    assert placed.json()["order"]["createdIndex"] == 2

    stepped = client.post("/api/v1/replay/step", headers=headers)
    assert stepped.status_code == 200
    body = stepped.json()
    assert body["candle"]["close"] == 130
    assert body["trading"]["positions"][0]["entry_price"] == 120


def test_reset_preserves_custom_trading_configuration():
    client = TestClient(app)
    session = uuid4()

    def configure(current):
        current.trading.fee_rate = 0.002
        current.trading.margin_rate = 0.2
        current.trading.maint_margin_rate = 0.08
        return None

    manager.atomic(str(session), configure)
    response = client.post("/api/v1/trading/reset", headers=h(session))
    assert response.status_code == 200
    fresh = manager.get(str(session)).trading
    assert fresh.fee_rate == 0.002
    assert fresh.margin_rate == 0.2
    assert fresh.maint_margin_rate == 0.08


def test_market_candle_rejects_fractional_index():
    client = TestClient(app)
    session = uuid4()
    response = client.post("/api/v1/trading/candle", headers=h(session), json={"symbol": "BTCUSDT", "candle": CANDLES[0], "index": 1.5})
    assert response.status_code == 422


def test_market_candle_rejects_index_that_differs_from_replay_index():
    client = TestClient(app)
    session = uuid4()
    assert client.post("/api/v1/replay/load", headers=h(session), json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/1", headers=h(session)).status_code == 200

    response = client.post(
        "/api/v1/trading/candle",
        headers=h(session),
        json={"symbol": "BTCUSDT", "candle": CANDLES[1], "index": 0},
    )

    assert response.status_code == 409
    assert "must match replay index" in response.json()["detail"]


def test_market_candle_requires_an_active_replay_index():
    client = TestClient(app)
    session = uuid4()
    response = client.post("/api/v1/trading/candle", headers=h(session), json={"symbol": "BTCUSDT", "candle": CANDLES[0], "index": 0})

    assert response.status_code == 409
    assert "start replay" in response.json()["detail"]


def test_order_requires_an_active_replay_index():
    client = TestClient(app)
    session = uuid4()

    response = client.post(
        "/api/v1/trading/order",
        headers=h(session),
        json={"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "type": "market"},
    )

    assert response.status_code == 409
    assert "start replay" in response.json()["detail"]
    assert manager.get(str(session)).trading.orders == {}


def test_funding_requires_an_open_position():
    client = TestClient(app)
    session = uuid4()
    assert client.post("/api/v1/replay/load", headers=h(session), json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=h(session)).status_code == 200

    response = client.post("/api/v1/trading/funding", headers=h(session), json={"rate": 0.01})

    assert response.status_code == 409
    assert "open position" in response.json()["detail"]
    assert manager.get(str(session)).trading.funding == []


def test_dataset_load_after_replay_only_progress_resets_trading_cursor_and_history():
    client = TestClient(app)
    session = uuid4()
    replacement = [
        {"time": 10, "open": 200, "high": 201, "low": 199, "close": 200, "volume": 1},
        {"time": 11, "open": 200, "high": 202, "low": 198, "close": 201, "volume": 1},
    ]
    h_session = h(session)

    assert client.post("/api/v1/replay/load", headers=h_session, json={"candles": CANDLES}).status_code == 200
    assert client.post("/api/v1/replay/start/0", headers=h_session).status_code == 200
    assert client.post("/api/v1/replay/step", headers=h_session).status_code == 200

    response = client.post("/api/v1/replay/load", headers=h_session, json={"candles": replacement})

    assert response.status_code == 200
    body = response.json()
    assert body["index"] == -1
    assert body["total"] == 2
    assert body["trading"]["index"] == -1
    assert body["trading"]["orders"] == []
    assert manager.get(str(session)).history == []
    assert client.post("/api/v1/replay/start/0", headers=h_session).status_code == 200


def test_cancel_all_clears_pending_orders():
    client = TestClient(app)
    session = uuid4()
    manager.get(str(session))
    manager.atomic(str(session), lambda current: current.trading.submit("BTCUSDT", "buy", 1, "limit", limit_price=90))

    response = client.post("/api/v1/trading/orders/cancel-all", headers=h(session), params={"reason": "TIMEFRAME_CHANGE"})

    assert response.status_code == 200
    body = response.json()
    assert body["pendingOrders"] == []
    assert body["orders"][0]["status"] == "CANCELLED"
    assert body["orders"][0]["cancelReason"] == "TIMEFRAME_CHANGE"
