class Events { constructor(){this.m=new Map()} on(e,h){const s=this.m.get(e)||new Set();s.add(h);this.m.set(e,s);return()=>s.delete(h)} emit(e,p){for(const h of this.m.get(e)||[])h(p)} }
export class RemoteTradingEngine {
 constructor(api){this.api=api;this.events=new Events();this.data={balance:0,equity:0,position:null,totalFees:0}}
 async refresh(){this.data=await this.api.request('/state');this.events.emit('stateChanged',this.data);return this.data}
 getAccountSnapshot(){return this.data} getPositions(){return this.data.position?[this.data.position]:[]} getPendingOrders(){return []} getOrders(){return []} getTrades(){return []} getPerformanceStats(){return {totalTrades:0,winRate:0,profitFactor:1,netReturn:0}} hasOpenPosition(){return !!this.data.position}
 on(e,h){return this.events.on(e,h)} async placeOrder(o){this.data=await this.api.request('/order',{method:'POST',body:JSON.stringify({side:o.side,quantity:o.quantity})});this.events.emit('stateChanged',this.data);return this.data}
 async closePosition(){this.data=await this.api.request('/close',{method:'POST'});this.events.emit('stateChanged',this.data);return this.data}
 async resetAccount(){this.data=await this.api.request('/reset',{method:'POST'});this.events.emit('stateChanged',this.data);return this.data}
 async onMarketCandle(){return this.refresh()} clearPendingOrders(){return true} setRisk(){return Promise.resolve({success:true})} setStopLoss(){return Promise.resolve({success:true})} setTakeProfit(){return Promise.resolve({success:true})} cancelOrder(){return Promise.resolve({success:false})}
}