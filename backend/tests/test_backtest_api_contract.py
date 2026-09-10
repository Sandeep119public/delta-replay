import uuid

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _payload():
    return {
        "candles": [
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10},
            {"time": 2, "open": 100, "high": 112, "low": 100, "close": 110, "volume": 20},
        ],
        "strategy": "buy_and_hold",
        "quantity": 2,
    }


def test_backtest_api_accepts_existing_candle_shape_and_custom_fee_rate():
    response = client.post(
        "/api/v1/backtest/run",
        json={**_payload(), "feeRate": 0},
        headers={"X-Session-ID": str(uuid.uuid4())},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["pnl"] == 20
    assert body["summary"]["fees"] == 0


def test_backtest_api_rejects_non_monotonic_candles():
    payload = _payload()
    payload["candles"][1]["time"] = payload["candles"][0]["time"]

    response = client.post(
        "/api/v1/backtest/run",
        json=payload,
        headers={"X-Session-ID": str(uuid.uuid4())},
    )

    assert response.status_code == 422
