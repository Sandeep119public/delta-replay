import math

import pytest
from pydantic import ValidationError

from app.models import AccountSnapshot, OrderRequest, Position
from app.routers.trading import CapitalRequest, CloseRequest, EngineOrder, FeeRateRequest, RiskRequest


@pytest.mark.parametrize(
    "model, payload, field",
    [
        (OrderRequest, {"side": "buy", "quantity": math.inf}, "quantity"),
        (EngineOrder, {"symbol": "BTCUSDT", "side": "buy", "quantity": math.inf}, "quantity"),
        (EngineOrder, {"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "limitPrice": math.inf}, "limitPrice"),
        (EngineOrder, {"symbol": "BTCUSDT", "side": "buy", "quantity": 1, "stopPrice": math.inf}, "stopPrice"),
        (RiskRequest, {"symbol": "BTCUSDT", "stopLoss": math.inf}, "stopLoss"),
        (RiskRequest, {"symbol": "BTCUSDT", "takeProfit": math.inf}, "takeProfit"),
        (CloseRequest, {"symbol": "BTCUSDT", "quantity": math.inf}, "quantity"),
        (CapitalRequest, {"balance": math.inf}, "balance"),
        (FeeRateRequest, {"rate": math.inf}, "rate"),
        (Position, {"side": "long", "quantity": math.inf, "entry_price": 100}, "quantity"),
        (Position, {"side": "long", "quantity": 1, "entry_price": math.inf}, "entry_price"),
        (AccountSnapshot, {"balance": math.inf, "equity": 100, "position": None}, "balance"),
    ],
)
def test_numeric_api_models_reject_infinity(model, payload, field):
    with pytest.raises(ValidationError) as exc_info:
        model.model_validate(payload)
    assert field in str(exc_info.value)


def test_numeric_api_models_reject_nan():
    with pytest.raises(ValidationError):
        EngineOrder.model_validate({"symbol": "BTCUSDT", "side": "buy", "quantity": math.nan})
