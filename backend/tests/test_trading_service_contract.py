import math

import pytest

from app.models import OrderRequest
from app.services.trading_service import TradingService


def test_open_rejects_invalid_price_before_mutating_order_state():
    service = TradingService()
    order = OrderRequest(side="buy", quantity=1)

    for price in (0, -1, float("nan"), float("inf")):
        with pytest.raises(ValueError, match="price must be finite and positive"):
            service.open(order, price)
        assert service.engine.orders == {}
        assert service.engine.positions == {}
        assert service.engine.index == -1


def test_open_accepts_positive_finite_price():
    service = TradingService()
    order = OrderRequest(side="buy", quantity=1)

    result = service.open(order, 100, "BTCUSDT")

    assert result["position"]["entry_price"] == 100
    assert service.engine.index == 0
    assert len(service.engine.orders) == 1
    assert not math.isnan(result["balance"])
