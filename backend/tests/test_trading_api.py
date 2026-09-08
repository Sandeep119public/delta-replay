from fastapi.testclient import TestClient
from app.main import app
from app.routers import replay, trading

def setup():
    trading.service=trading.PaperTradingEngine()
    replay.service.load([
      {"time":1,"open":100,"high":101,"low":99,"close":100,"volume":1},
      {"time":2,"open":100,"high":120,"low":80,"close":110,"volume":1},
      {"time":3,"open":110,"high":130,"low":90,"close":120,"volume":1},
    ]); replay.service.start(0)

def test_full_lifecycle():
    setup(); c=TestClient(app)
    r=c.post("/api/v1/trading/order",json={"side":"buy","quantity":1,"type":"market"}); assert r.status_code==200
    c.post("/api/v1/replay/step"); r=c.post("/api/v1/trading/candle"); assert r.status_code==200
    c.post("/api/v1/replay/step"); c.post("/api/v1/trading/candle")
    assert c.get("/api/v1/trading/state").json()["positions"]
    assert c.post("/api/v1/trading/risk",json={"stopLoss":95,"takeProfit":125}).status_code==200
    assert isinstance(c.get("/api/v1/trading/orders").json()["orders"],list)
