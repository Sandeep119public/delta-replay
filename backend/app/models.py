from math import isfinite
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Candle(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    time: int = Field(ge=0)
    open: float
    high: float
    low: float
    close: float
    volume: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_ohlc(self):
        values = (self.open, self.high, self.low, self.close)
        if not all(isfinite(value) for value in values):
            raise ValueError("candle OHLC values must be finite")
        if self.high < max(self.open, self.close):
            raise ValueError("candle high is below open/close")
        if self.low > min(self.open, self.close):
            raise ValueError("candle low is above open/close")
        if self.high < self.low:
            raise ValueError("candle high is below low")
        return self


class CandleBatch(BaseModel):
    candles: list[Candle] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_chronology(self):
        times = [candle.time for candle in self.candles]
        if any(current <= previous for previous, current in zip(times, times[1:])):
            raise ValueError("candles must be strictly ordered by increasing time")
        return self


class OrderRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0)


class Position(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    side: Literal["long", "short"]
    quantity: float = Field(gt=0)
    entry_price: float = Field(gt=0)


class AccountSnapshot(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    balance: float
    equity: float
    position: Position | None
