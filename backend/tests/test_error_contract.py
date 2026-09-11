from uuid import uuid4

from fastapi.testclient import TestClient

from app.domain.errors import StateInvariantError, TradingDomainError
from app.main import app
from app.services.paper_engine import PaperTradingEngine


def headers(session):
    return {"X-Session-ID": str(session)}


def valid_candle(index=0):
    return {"time": index + 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1}


def test_invalid_candle_index_is_a_domain_error_and_http_422():
    client = TestClient(app)
    session = uuid4()
    response = client.post(
        "/api/v1/trading/candle",
        headers=headers(session),
        json={"symbol": "BTCUSDT", "candle": valid_candle(), "index": 1.5},
    )
    assert response.status_code == 422


def test_paper_engine_rejects_expected_order_constraints_without_masking_invariants():
    engine = PaperTradingEngine()
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(valid_candle(0), 0, "BTCUSDT")
    try:
        engine.submit("BTCUSDT", "buy", 1)
    except TradingDomainError:
        pass
    else:
        raise AssertionError("expected a domain error")

    engine = PaperTradingEngine()
    engine.submit("BTCUSDT", "buy", 1)
    original = engine.account.validate_invariants

    def broken_invariants():
        raise ValueError("synthetic invariant failure")

    engine.account.validate_invariants = broken_invariants
    try:
        try:
            engine.on_candle(valid_candle(1), 1, "BTCUSDT")
        except StateInvariantError:
            pass
        else:
            raise AssertionError("expected state invariant failure")
    finally:
        engine.account.validate_invariants = original


def test_state_invariant_error_is_not_reported_as_order_rejection():
    engine = PaperTradingEngine()
    engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=100)
    original = engine.account.validate_invariants

    def broken_invariants():
        raise ValueError("synthetic invariant failure")

    engine.account.validate_invariants = broken_invariants
    try:
        try:
            engine.on_candle(valid_candle(1), 1, "BTCUSDT")
        except StateInvariantError:
            assert engine.orders[1]["status"] == "PENDING"
        else:
            raise AssertionError("expected invariant failure to escape order rejection handling")
    finally:
        engine.account.validate_invariants = original
