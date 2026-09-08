from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from ..models import OrderRequest, Candle
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
    candle: Candle|None=None
    index: int|None=None

def snapshot(): return service.snapshot()
def candle():
    c=replay_service.state().get("candle")
    if not c: raise HTTPException(409,"Load data and start replay before trading")
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
    c = request.candle.model_dump() if request.candle is not None else candle()
    index = request.index if request.index is not None else replay_service.state()["index"]
    events=service.on_candle(c,index)
    return {"events":events,**snapshot()}
@router.post("/reset")
def reset():
    global service; service=PaperTradingEngine(); return snapshot()
