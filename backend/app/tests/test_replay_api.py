from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

CANDLES = [{"time": 1, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10}, {"time": 2, "open": 101, "high": 103, "low": 100, "close": 102, "volume": 11}]

def test_health():
    assert client.get('/health').json()['status'] == 'ok'

def test_replay_lifecycle():
    loaded = client.post('/api/v1/replay/load', json={"candles": CANDLES}).json()
    assert loaded['total'] == 2 and loaded['index'] == 0
    stepped = client.post('/api/v1/replay/step').json()
    assert stepped['index'] == 1
    reset = client.post('/api/v1/replay/reset').json()
    assert reset['index'] == 0
