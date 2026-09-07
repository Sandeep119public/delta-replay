from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_csv_upload_to_replay_flow():
    response = client.post('/api/v1/data/csv', files={'file': ('market.csv', 'time,open,high,low,close,volume\n1,100,102,99,101,10\n2,101,103,100,102,11\n', 'text/csv')})
    assert response.status_code == 200
    data = response.json()
    assert data['count'] == 2
    loaded = client.post('/api/v1/replay/load', json={'candles': data['candles']}).json()
    assert loaded['total'] == 2

def test_backtest_endpoint_returns_trade_summary():
    candles = [{'time': 1, 'open': 100, 'high': 102, 'low': 99, 'close': 100, 'volume': 10}, {'time': 2, 'open': 100, 'high': 112, 'low': 100, 'close': 110, 'volume': 20}]
    response = client.post('/api/v1/backtest/run', json={'candles': candles, 'strategy': 'buy_and_hold', 'quantity': 2})
    assert response.status_code == 200
    assert response.json()['summary']['pnl'] == 20
