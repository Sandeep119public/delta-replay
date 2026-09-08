class Events{constructor(){this.m=new Map()}on(e,h){const s=this.m.get(e)||new Set();s.add(h);this.m.set(e,s);return()=>s.delete(h)}emit(e,p){for(const h of this.m.get(e)||[])h(p)}}
export class RemoteTradingEngine{
 constructor(api){this.api=api;this.events=new Events();this.data={account:{},positions:[],orders:[],trades:[]}}
 async _request(path,options){const r=await this.api.request(path,options);this._sync(r);return r}
 _sync(r){if(r&&r.account)this.data={...this.data,...r};this.events.emit('stateChanged',this.getAccountSnapshot())}
 async refresh(){return this._request('/state')}
 getAccountSnapshot(){return this.data.account||{}} getPositions(){return this.data.positions||[]} getOrders(){return this.data.orders||[]} getPendingOrders(){return this.getOrders().filter(o=>o.status==='PENDING')} getTrades(){return this.data.trades||[]} hasOpenPosition(){return this.getPositions().length>0}
 getPerformanceStats(){const t=this.getTrades(),wins=t.filter(x=>(x.netPnL??0)>0),grossWin=wins.reduce((s,x)=>s+(x.netPnL||0),0),grossLoss=Math.abs(t.filter(x=>(x.netPnL??0)<0).reduce((s,x)=>s+(x.netPnL||0),0));return {totalTrades:t.length,winRate:t.length?wins.length/t.length:0,profitFactor:grossLoss?grossWin/grossLoss:grossWin?Infinity:0,netReturn:t.reduce((s,x)=>s+(x.netPnL||0),0)}}
 on(e,h){return this.events.on(e,h)}
 async placeOrder(o){return this._request('/order',{method:'POST',body:JSON.stringify({side:o.side,quantity:o.quantity,type:o.type||'market',limitPrice:o.limitPrice??null,stopPrice:o.stopPrice??null})})}
 async closePosition(quantity){return this._request('/close',{method:'POST',body:JSON.stringify({quantity:quantity??null})})}
 async cancelOrder(id){return this._request('/orders/'+id+'/cancel',{method:'POST'})}
 async clearPendingOrders(){for(const o of this.getPendingOrders())await this.cancelOrder(o.id);return true}
 async setRisk(stopLoss,takeProfit){return this._request('/risk',{method:'POST',body:JSON.stringify({stopLoss:stopLoss??null,takeProfit:takeProfit??null})})}
 setStopLoss(v){const p=this.getPositions()[0];return this.setRisk(v,p?.take_profit??p?.takeProfit??null)} setTakeProfit(v){const p=this.getPositions()[0];return this.setRisk(p?.stop_loss??p?.stopLoss??null,v)}
 async resetAccount(){return this._request('/reset',{method:'POST'})}
 async onMarketCandle(){return this._request('/candle',{method:'POST'})}
}