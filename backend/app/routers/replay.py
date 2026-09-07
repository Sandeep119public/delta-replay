from fastapi import APIRouter, HTTPException
from ..services.replay_service import ReplayService
router=APIRouter(); service=ReplayService()
@router.get('/state')
def state(): return service.state()
@router.post('/load')
def load(candles:list[dict]): return service.load(candles)
@router.post('/step')
def step(): return service.step()
@router.post('/reset')
def reset(): return service.reset()
