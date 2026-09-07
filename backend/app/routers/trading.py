from fastapi import APIRouter, HTTPException
from ..models import OrderRequest
from ..services.trading_service import TradingService
from .replay import service as replay_service

router=APIRouter()
service=TradingService()

def mark():
    candle=replay_service.state().get("candle")
    if not candle: raise HTTPException(409,"Load data and advance replay before trading")
    return float(candle["close"])

@router.get("/state")
def state(): return service.snapshot(replay_service.state().get("candle",{}).get("close"))

@router.post("/order")
def order(request: OrderRequest): return service.open(request, mark())

@router.post("/close")
def close(): return service.close(mark())

@router.post("/reset")
def reset(): return service.reset()
