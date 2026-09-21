from math import isfinite
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MAX_CANDLES = 100_000


class Candle(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    time: int = Field(ge=0)
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
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
    candles: list[Candle] = Field(min_length=1, max_length=MAX_CANDLES)

    @model_validator(mode="after")
    def validate_chronology(self):
        times = [candle.time for candle in self.candles]
        if any(current <= previous for previous, current in zip(times, times[1:])):
            raise ValueError("candles must be strictly ordered by increasing time")
        return self


class DatasetDownloadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    symbol: str = Field(min_length=1)
    timeframe: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self):
        if self.start >= self.end:
            raise ValueError("end must be after start")
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
