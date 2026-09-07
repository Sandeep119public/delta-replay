import pytest
from app.models import OrderRequest
from app.services.trading_service import TradingService

def test_long_profit_after_fees():
    service = TradingService()
    service.open(OrderRequest(side='buy', quantity=2), 100)
    result = service.close(110)
    assert result['balance'] == pytest.approx(10019.79)
    assert result['totalFees'] == pytest.approx(0.21)

def test_short_profit_after_fees():
    service = TradingService()
    service.open(OrderRequest(side='sell', quantity=2), 100)
    result = service.close(90)
    assert result['balance'] == pytest.approx(10019.81)
    assert result['totalFees'] == pytest.approx(0.19)

def test_second_position_is_rejected():
    service = TradingService()
    service.open(OrderRequest(side='buy', quantity=1), 100)
    with pytest.raises(ValueError, match='position already open'):
        service.open(OrderRequest(side='sell', quantity=1), 100)
