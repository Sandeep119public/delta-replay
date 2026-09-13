import pytest

from app.models import OrderRequest
from app.services.trading_service import TradingService


def test_snapshot_with_mark_price_does_not_mutate_engine_state():
    service = TradingService()
    service.open(OrderRequest(side="buy", quantity=1), 100, "BTCUSDT")
    before = service.engine.snapshot()

    snapshot = service.snapshot(110)

    assert snapshot["position"]["current_price"] == 110
    assert service.engine.snapshot() == before


def test_process_candle_rejects_unsupported_policy_instead_of_ignoring_it():
    service = TradingService()
    with pytest.raises(ValueError, match="unsupported ambiguity policy"):
        service.process_candle(
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 0},
            policy="unknown",
        )


def test_process_candle_rejects_noncanonical_policy_that_would_be_ignored():
    service = TradingService()
    with pytest.raises(ValueError, match="only the canonical conservative"):
        service.process_candle(
            {"time": 1, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 0},
            policy="tp_first",
        )
