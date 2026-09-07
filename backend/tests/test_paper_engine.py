from app.services.paper_engine import PaperTradingEngine

def candle(o,h,l,c,t=1): return {"open":o,"high":h,"low":l,"close":c,"time":t}

def test_market_order_executes_next_bar_open():
    e=PaperTradingEngine(); e.submit("BTCUSD","buy",1)
    e.on_candle(candle(100,105,95,102),0)
    assert not e.positions
    e.on_candle(candle(110,115,108,112),1)
    assert e.positions["BTCUSD"]["entry_price"]==110

def test_stop_and_take_profit_are_not_same_bar_as_creation():
    e=PaperTradingEngine(); e.submit("BTCUSD","buy",1); e.on_candle(candle(100,101,99,100),0); e.on_candle(candle(100,101,99,100),1)
    e.set_risk("BTCUSD",90,110)
    e.on_candle(candle(100,120,80,100),1)
    assert "BTCUSD" in e.positions
    e.on_candle(candle(100,120,80,100),2)
    assert not e.positions and e.trades[-1]["exitReason"]=="STOP_LOSS"

def test_limit_and_stop_gap_prices():
    e=PaperTradingEngine(); e.submit("BTCUSD","buy",1,"limit",limit_price=100);e.on_candle(candle(95,99,90,96),1)
    assert e.orders[1]["status"]=="FILLED" and e.orders[1]["filledPrice"]==95

def test_liquidation_closes_position():
    e=PaperTradingEngine(starting_balance=100,margin_rate=.1,maint_margin_rate=.05);e.submit("BTCUSD","buy",1);e.on_candle(candle(100,100,100,100),0);e.on_candle(candle(100,100,100,100),1);e.on_candle(candle(1,2,0.5,1),2)
    assert not e.positions or e.account.equity>=e.account.maintenance_margin
