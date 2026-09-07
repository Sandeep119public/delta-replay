from fastapi import APIRouter, HTTPException
from ..models import OrderRequest
from ..services.trading_service import TradingService
from .replay import service as replay_service

router = APIRouter()
service = TradingService()

def mark():
    candle = replay_service.state().get('candle')
    if not candle:
        raise HTTPException(409, 'Load data and start replay before trading')
    return float(candle['close'])

@router.get('/state')
def state():
    candle = replay_service.state().get('candle')
    return service.snapshot(float(candle['close']) if candle else None)

@router.post('/order')
def order(request: OrderRequest):
    try:
        return service.open(request, mark())
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

@router.post('/close')
def close():
    try:
        return service.close(mark())
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

@router.post('/reset')
def reset():
    return service.reset()
