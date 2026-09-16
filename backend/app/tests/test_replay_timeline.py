import pytest

from app.services.paper_engine import PaperTradingEngine
from app.services.replay_service import ReplayService
from app.services.replay_timeline import ReplayDivergenceError, rebuild_trading


CANDLES = [
    {"time": 1, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10},
    {"time": 2, "open": 101, "high": 103, "low": 100, "close": 102, "volume": 11},
]


def build_replay():
    replay = ReplayService()
    replay.load(CANDLES)
    replay.start(0)
    return replay


def test_rebuild_uses_canonical_candle_for_recorded_candle_event():
    replay = build_replay()
    history = [
        {
            "type": "candle",
            "replayIndex": 0,
            "payload": {
                "symbol": "BTCUSDT",
                "index": 0,
                "candle": CANDLES[0],
            },
        }
    ]

    engine = rebuild_trading(replay, history, 0)

    assert engine.index == 0
    assert engine.get_latest_market("BTCUSDT")["candle"] == CANDLES[0]


def test_rebuild_rejects_noncanonical_recorded_candle_event():
    replay = build_replay()
    history = [
        {
            "type": "candle",
            "replayIndex": 0,
            "payload": {
                "symbol": "BTCUSDT",
                "index": 0,
                "candle": {**CANDLES[0], "volume": 999},
            },
        }
    ]

    with pytest.raises(ReplayDivergenceError, match="does not match canonical replay candle"):
        rebuild_trading(replay, history, 0)


def test_rebuild_rejects_candle_payload_index_mismatch():
    replay = build_replay()
    history = [
        {
            "type": "candle",
            "replayIndex": 0,
            "payload": {
                "symbol": "BTCUSDT",
                "index": 1,
                "candle": CANDLES[0],
            },
        }
    ]

    with pytest.raises(ReplayDivergenceError, match="index does not match"):
        rebuild_trading(replay, history, 0)


def test_rebuild_requires_replay_data_for_recorded_candle_event():
    engine = PaperTradingEngine()
    command = {
        "type": "candle",
        "replayIndex": 0,
        "payload": {
            "symbol": "BTCUSDT",
            "index": 0,
            "candle": CANDLES[0],
        },
    }

    from app.services.replay_timeline import _apply_command

    with pytest.raises(ReplayDivergenceError, match="requires replay data"):
        _apply_command(engine, command)
