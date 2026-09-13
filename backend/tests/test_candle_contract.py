import math

import pytest
from pydantic import ValidationError

from app.models import MAX_CANDLES, Candle, CandleBatch
from app.services.backtest_service import BacktestService
from app.services.replay_service import ReplayService


def valid_candle(time=1):
    return {"time": time, "open": 100, "high": 105, "low": 95, "close": 102, "volume": 10}


def test_candle_accepts_valid_ohlcv():
    candle = Candle.model_validate(valid_candle())
    assert candle.model_dump() == valid_candle()


@pytest.mark.parametrize(
    "patch",
    [
        {"time": -1},
        {"volume": -1},
        {"high": 99},
        {"low": 103},
        {"high": 90, "low": 95},
        {"open": math.inf},
        {"close": math.nan},
    ],
)
def test_candle_rejects_invalid_market_data(patch):
    payload = {**valid_candle(), **patch}
    with pytest.raises(ValidationError):
        Candle.model_validate(payload)


def test_candle_batch_rejects_excessive_candle_count():
    candles = [valid_candle(index) for index in range(1, MAX_CANDLES + 2)]
    with pytest.raises(ValidationError):
        CandleBatch.model_validate({"candles": candles})


def test_replay_load_enforces_same_candle_contract():
    replay = ReplayService()
    with pytest.raises(ValueError):
        replay.load([{**valid_candle(), "high": 90}])


def test_backtest_enforces_same_candle_contract():
    service = BacktestService()
    with pytest.raises(ValueError, match="invalid candle data"):
        service.run([{**valid_candle(), "low": 110}])
