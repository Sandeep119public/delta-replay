from app.services.paper_engine import PaperTradingEngine

def candle(o,h,l,c,t=1): return {"open":o,"high":h,"low":l,"close":c,"time":t}

def fill_long(e, price=100):
    e.submit("BTCUSD","buy",2); e.on_candle(candle(price,price,price,price),0); e.on_candle(candle(price,price,price,price),1)

def test_market_order_executes_next_bar_open():
    e=PaperTradingEngine(); e.submit("BTCUSD","buy",1); e.on_candle(candle(100,105,95,102),0); assert not e.positions
    e.on_candle(candle(110,115,108,112),1); assert e.positions["BTCUSD"]["entry_price"]==110

def test_partial_close_preserves_remaining_position():
    e=PaperTradingEngine(); fill_long(e); e.close("BTCUSD",110,quantity=1)
    assert e.positions["BTCUSD"]["quantity"]==1 and e.trades[-1]["quantity"]==1

def test_cancel_pending_order():
    e=PaperTradingEngine(); o=e.submit("BTCUSD","buy",1,"limit",limit_price=50); e.cancel(o["id"])
    assert e.orders[o["id"]]["status"]=="CANCELLED"

def test_validation_rejects_bad_orders():
    e=PaperTradingEngine()
    for args in [("BTCUSD","hold",1),("BTCUSD","buy",0),("BTCUSD","buy",1,"limit")]:
        try:e.submit(*args); assert False
        except ValueError:pass

def test_stop_and_take_profit_are_not_same_bar_as_creation():
    e=PaperTradingEngine(); e.submit("BTCUSD","buy",1); e.on_candle(candle(100,101,99,100),0); e.on_candle(candle(100,101,99,100),1); e.set_risk("BTCUSD",90,110)
    e.on_candle(candle(100,120,80,100),1); assert "BTCUSD" in e.positions
    e.on_candle(candle(100,120,80,100),2); assert not e.positions and e.trades[-1]["exitReason"]=="STOP_LOSS"
