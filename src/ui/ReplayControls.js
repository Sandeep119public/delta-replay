import { ReplayEvents } from '../replay/ReplayEvents.js';

export class ReplayControls {
  constructor({ playBtn, pauseBtn, stepBtn, resetBtn, startReplayBtn, speedSelect, statusEl, replayPort, followBtn = null, onFollowClick = null }) {
    this.playBtn=playBtn;this.pauseBtn=pauseBtn;this.stepBtn=stepBtn;this.resetBtn=resetBtn;this.startReplayBtn=startReplayBtn;this.speedSelect=speedSelect;this.statusEl=statusEl;this.replayPort=replayPort;this.followBtn=followBtn;this.onFollowClick=onFollowClick;this._listeners=[];this._subscriptions=[];
    this._listen=(el,type,handler)=>{el?.addEventListener?.(type,handler);this._listeners.push([el,type,handler]);};
    this._listen(playBtn,'click',()=>this._safeAction(()=>this.replayPort.play()));
    this._listen(pauseBtn,'click',()=>this._safeAction(()=>this.replayPort.pause()));
    this._listen(stepBtn,'click',()=>this._safeAction(()=>this.replayPort.stepForward()));
    this._listen(resetBtn,'click',()=>this._safeAction(()=>this.replayPort.reset()));
    this._listen(startReplayBtn,'click',()=>this._safeAction(()=>this.replayPort.start(Number(this.startReplayBtn.dataset.startIndex??'0'))));
    this._listen(speedSelect,'change',()=>this._safeAction(()=>this.replayPort.setSpeed(this.speedSelect.value),()=>{this.speedSelect.value=String(this.replayPort.getState().speed);}));
    if(followBtn)this._listen(followBtn,'click',()=>{this.onFollowClick?.();this.followBtn.classList.add('hidden');});
    this._subscriptions.push(this.replayPort.on(ReplayEvents.STATE_CHANGED,state=>this.render(state)),this.replayPort.on(ReplayEvents.SPEED_CHANGED,({speed})=>{this.speedSelect.value=String(speed);}));this.render(this.replayPort.getState());
  }
  destroy(){this._listeners.forEach(([el,t,h])=>el?.removeEventListener?.(t,h));this._subscriptions.forEach(u=>{try{u?.();}catch{}});this._listeners=[];this._subscriptions=[];try{document?.body?.classList?.remove('velocity-boost');}catch{}}
  _safeAction(action,onError=null){try{return action();}catch(error){console.warn('[ReplayControls]',error?.message||error);onError?.(error);return this.replayPort.getState();}}
  setStartIndex(idx){const n=Number(idx),valid=Number.isInteger(n)&&n>=0&&n<this.replayPort.getTotalCandles();if(valid){this.startReplayBtn.dataset.startIndex=String(n);this.startReplayBtn.disabled=false;}else{delete this.startReplayBtn.dataset.startIndex;this.startReplayBtn.disabled=true;}}
  render(state){if(!state)return;const isIdle=state.status==='idle',isReady=state.status==='ready',isPlaying=state.status==='playing',isPaused=state.status==='paused',isEnded=state.status==='ended',hasData=state.totalCandles>0;if(this.statusEl){this.statusEl.textContent=state.status.toUpperCase();this.statusEl.className=`replay-status ${state.status}`;}try{if(typeof document!=='undefined'&&document.body?.classList)document.body.classList.toggle('velocity-boost',Number(state.speed)>=5);}catch{}this.startReplayBtn.disabled=!hasData||!isReady;this.startReplayBtn.textContent='START REPLAY';this.playBtn.classList.toggle('hidden',isPlaying);this.pauseBtn.classList.toggle('hidden',!isPlaying);this.playBtn.disabled=!isPaused;this.pauseBtn.disabled=!isPlaying;this.stepBtn.disabled=!(isPaused&&state.currentIndex<state.totalCandles-1);this.resetBtn.disabled=!hasData||isIdle||isReady;this.speedSelect.disabled=!hasData||isIdle;if(isReady){this.playBtn.disabled=true;this.pauseBtn.disabled=true;this.stepBtn.disabled=true;}if(isEnded){this.playBtn.disabled=true;this.pauseBtn.disabled=true;this.stepBtn.disabled=true;this.resetBtn.disabled=state.startIndex<0;}}
  setEnabledForPreview(){} setAutoFollow(isFollowing){this.followBtn?.classList.toggle('hidden',isFollowing);}
}
