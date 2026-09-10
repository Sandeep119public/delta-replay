from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models import Candle
from ..services.backtest_service import BacktestService, TAKER_FEE_RATE

router = APIRouter()
service = BacktestService()


class BacktestRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    candles: list[Candle] = Field(min_length=1)
    strategy: str = "buy_and_hold"
    quantity: float = Field(default=1, gt=0)
    feeRate: float = Field(default=TAKER_FEE_RATE, ge=0, lt=1)

    @model_validator(mode="after")
    def validate_chronology(self):
        times = [candle.time for candle in self.candles]
        if any(current <= previous for previous, current in zip(times, times[1:])):
            raise ValueError("candles must be strictly ordered by increasing time")
        return self


@router.post("/run")
def run(request: BacktestRequest):
    try:
        return service.run(
            request.candles,
            request.strategy,
            request.quantity,
            request.feeRate,
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
