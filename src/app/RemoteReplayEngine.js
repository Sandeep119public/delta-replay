class Events { constructor(){this.m=new Map()} on(e,h){const s=this.m.get(e)||new Set();s.add(h);this.m.set(e,s);return()=>s.delete(h)} emit(e,p){for(const h of this.m.get(e)||[])h(p)} }
export class RemoteReplayEngine {
 constructor(api,tradingEngine=null){this.api=api;this.tradingEngine=tradingEngine;this.events=new Events();this.state={status:'idle',currentIndex:-1,startIndex:-1,total:0,speed:1}}
 async _call(path,opts){const data=await this.api.request(path,opts);this._sync(data);if(this.tradingEngine&&data.candle&&(/\\/(step|seek|start)\\b/.test(path)))await this.tradingEngine.onMarketCandle();return this.state}
 _sync(s){this.state={...this.state,status:s.status,currentIndex:s.index,startIndex:s.startIndex,total:s.total,speed:s.speed};this.events.emit('stateChanged',this.state)}
 on(e,h){return this.events.on(e,h)} getState(){return {...this.state}} getTotalCandles(){return this.state.total}
 async load(candles){return this._call('/load',{method:'POST',body:JSON.stringify({candles:Array.isArray(candles)?candles:[]})})}
 async start(i=0){return this._call('/start/'+i,{method:'POST'})} async stepForward(){return this._call('/step',{method:'POST'})}
 async seek(i){return this._call('/seek/'+i,{method:'POST'})} async reset(){return this._call('/reset',{method:'POST'})}
 async play(){this.state.status='playing';this.events.emit('stateChanged',this.state);return this.state} async pause(){this.state.status='paused';this.events.emit('stateChanged',this.state);return this.state}
 setSpeed(v){this.state.speed=v;this.events.emit('speedChanged',v)} registerActionGuard(){return()=>{}}
}