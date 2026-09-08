from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from ..models import OrderRequest
from ..services.paper_engine import PaperTradingEngine
from .replay import service as replay_service

router=APIRouter(); service=PaperTradingEngine()

class EngineOrder(BaseModel):
    side: Literal["buy","sell"]; quantity: float=Field(gt=0); type: Literal["market","limit","stop_market"]="market"; limitPrice: float|None=None; stopPrice: float|None=None
class RiskRequest(BaseModel):
    stopLoss: float|None=None; takeProfit: float|None=None
class CloseRequest(BaseModel):
    quantity: float|None=None
class MarketCandleRequest(BaseModel):
    candle: dict|None=None
    index: int|None=None

def snapshot(): return service.snapshot()
def candle():
    c=replay_service.state().get("candle")
    if not c: raise HTTPException(409,"Load data and start replay before trading")
    return c

def normalize_candle(raw):
    if not isinstance(raw,dict): raise HTTPException(422,"candle must be an object")
    try:
        c={
            "time": int(float(raw.get("time"))),
            "open": float(raw.get("open")),
            "high": float(raw.get("high")),
            "low": float(raw.get("low")),
            "close": float(raw.get("close")),
            "volume": float(raw.get("volume",0) or 0),
        }
    except (TypeError,ValueError):
        raise HTTPException(422,"candle must contain numeric time/open/high/low/close/volume fields")
    if c["time"] < 0 or any(not __import__('math').isfinite(v) for v in c.values() if isinstance(v,(int,float))):
        raise HTTPException(422,"candle contains non-finite or invalid numeric values")
    if c["high"] < max(c["open"],c["close"]) or c["low"] > min(c["open"],c["close"]) or c["high"] < c["low"]:
        raise HTTPException(422,"candle OHLC values are inconsistent")
    return c

@router.get("/state")
def state(): return snapshot()
@router.get("/orders")
def orders(): return {"orders":list(service.orders.values()),"pendingOrders":[o for o in service.orders.values() if o["status"]=="PENDING"]}
@router.get("/trades")
def trades(): return {"trades":service.trades}
@router.post("/order")
def order(request:EngineOrder):
    try:
        o=service.submit("BTCUSD",request.side,request.quantity,request.type,request.limitPrice,request.stopPrice)
        return {"order":o,**snapshot()}
    except ValueError as e: raise HTTPException(422,str(e))
@router.post("/close")
def close(request:CloseRequest=CloseRequest()):
    try:
        c=candle(); trade=service.close("BTCUSD",float(c["close"]),quantity=request.quantity,timestamp=c.get("time"))
        if not trade: raise HTTPException(422,"no open position")
        return {"trade":trade,**snapshot()}
    except ValueError as e: raise HTTPException(422,str(e))
@router.post("/orders/{order_id}/cancel")
def cancel(order_id:int):
    try:return {"order":service.cancel(order_id),**snapshot()}
    except ValueError as e: raise HTTPException(422,str(e))
@router.post("/risk")
def risk(request:RiskRequest):
    try:return {"position":service.set_risk("BTCUSD",request.stopLoss,request.takeProfit),**snapshot()}
    except (ValueError,KeyError) as e: raise HTTPException(422,str(e))
@router.post("/candle")
def process(request: MarketCandleRequest|None = None):
    request = request or MarketCandleRequest()
    c = normalize_candle(request.candle) if request.candle is not None else normalize_candle(candle())
    index = request.index if request.index is not None else replay_service.state()["index"]
    events=service.on_candle(c,index)
    return {"events":events,**snapshot()}
@router.post("/reset")
def reset():
    global service; service=PaperTradingEngine(); return snapshot()
