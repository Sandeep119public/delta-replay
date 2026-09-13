import pytest

from app.services.execution_service import ExecutionService
from app.services.paper_engine import PaperTradingEngine


def test_place_validates_explicit_creation_index_before_mutating_engine():
    engine = PaperTradingEngine()
    service = ExecutionService(engine)

    with pytest.raises(ValueError, match="created index must be between"):
        service.place("BTCUSDT", "buy", 1, index=0)

    assert engine.orders == {}
    assert service.orders == {}
    assert service.pending == []
    assert service.next_id == 1


def test_place_preserves_explicit_creation_index_on_canonical_order():
    engine = PaperTradingEngine()
    engine.on_candle({"open": 100, "high": 101, "low": 99, "close": 100, "time": 1}, 0, "BTCUSDT")
    service = ExecutionService(engine)

    placed = service.place("BTCUSDT", "buy", 1, index=0)

    assert placed.created_index == 0
    assert engine.orders[placed.id]["createdIndex"] == 0
