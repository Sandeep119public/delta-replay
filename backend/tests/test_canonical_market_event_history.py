from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import ReplayDivergenceError, rebuild_trading


client = TestClient(app)


def candle(time, price):
    return {"time": time, "open": price, "high": price + 2, "low": price - 2, "close": price + 1, "volume": 1}


def replay():
    service = ReplayService()
    service.load([candle(1, 100), candle(2, 102), candle(3, 104)])
    service.start(0)
    return service


def test_rebuild_supports_candle_events_as_the_canonical_market_stream():
    service = replay()
    history = [
        {"type": "candle", "replayIndex": 0, "payload": {"candle": service.candles[0], "index": 0, "symbol": "ETHUSDT"}},
        {"type": "order", "replayIndex": 0, "payload": {"symbol": "ETHUSDT", "side": "buy", "quantity": 1, "type": "market", "limitPrice": None, "stopPrice": None}},
        {"type": "candle", "replayIndex": 1, "payload": {"candle": service.candles[1], "index": 1, "symbol": "ETHUSDT"}},
    ]

    rebuilt = rebuild_trading(service, history, 1)

    assert rebuilt.index == 1
    assert rebuilt.positions["ETHUSDT"]["entry_price"] == 103


def test_rebuild_rejects_two_kinds_of_market_event_at_one_index():
    service = replay()
    history = [
        {"type": "market_step", "replayIndex": 0, "payload": {"symbol": "BTCUSDT"}},
        {"type": "candle", "replayIndex": 0, "payload": {"candle": service.candles[0], "index": 0, "symbol": "BTCUSDT"}},
    ]

    with pytest.raises(ReplayDivergenceError, match="multiple market events"):
        rebuild_trading(service, history, 0)


def test_manual_candle_without_symbol_uses_latest_replay_symbol():
    session_id = str(uuid4())
    headers = {"X-Session-ID": session_id}
    payload = {"candles": [candle(1, 100), candle(2, 102)]}

    try:
        assert client.post("/api/v1/replay/load", headers=headers, json=payload).status_code == 200
        started = client.post("/api/v1/replay/start/0", headers=headers, params={"symbol": "ETHUSDT"})
        assert started.status_code == 200

        response = client.post(
            "/api/v1/trading/candle",
            headers=headers,
            json={"candle": candle(1, 100), "index": 0},
        )

        assert response.status_code == 409
        assert "market event" in response.json()["detail"]
    finally:
        from app.services.session_manager import manager
        manager.delete(session_id)
