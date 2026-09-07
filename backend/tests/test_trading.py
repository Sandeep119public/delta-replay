from app.services.trading_service import TradingService
from app.models import OrderRequest

def test_long_profit():
    service=TradingService()
    service.open(OrderRequest(side="buy",quantity=2),100)
    result=service.close(110)
    assert result["balance"]==10020

def test_short_profit():
    service=TradingService()
    service.open(OrderRequest(side="sell",quantity=2),100)
    result=service.close(90)
    assert result["balance"]==10020
