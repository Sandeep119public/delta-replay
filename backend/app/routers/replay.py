from fastapi import APIRouter
from ..models import CandleBatch
from ..services.replay_service import ReplayService

router = APIRouter()
service = ReplayService()

@router.get('/state')
def state():
    return service.state()

@router.post('/load')
def load(batch: CandleBatch):
    return service.load(batch)

@router.post('/step')
def step():
    return service.step()

@router.post('/reset')
def reset():
    return service.reset()
