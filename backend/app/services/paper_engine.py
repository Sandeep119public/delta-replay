from ..domain.account import TradingAccount
from ..domain.ambiguity import evaluate
class PaperTradingEngine:
 def __init__(self,starting_balance=10000,fee_rate=.0005,margin_rate=.1,maint_margin_rate=.05):
  self.account=TradingAccount(starting_balance);self.fee_rate=fee_rate;self.margin_rate=margin_rate;self.maint_margin_rate=maint_margin_rate;self.positions={};self.orders={};self.trades=[];self.index=-1;self._next_order=1
 def fee(self,p,q):return abs(p*q)*self.fee_rate
 def mark(self,symbol,price):
  if symbol in self.positions:self.positions[symbol]["current_price"]=price
  self._recalc()
 def _recalc(self):
  u=used=maint=0
  for p in self.positions.values():
   sign=1 if p["side"]=="long" else -1;mark=p["current_price"];u+=(mark-p["entry_price"])*p["quantity"]*sign;used+=mark*p["quantity"]*self.margin_rate;maint+=mark*p["quantity"]*self.maint_margin_rate
  self.account.unrealized_pnl=u;self.account.used_margin=used;self.account.maintenance_margin=maint
 def submit(self,symbol,side,quantity,type="market",limit_price=None,stop_price=None):
  if side not in ("buy","sell"): raise ValueError("side must be buy or sell")
  if quantity<=0: raise ValueError("quantity must be positive")
  if type not in ("market","limit","stop_market"): raise ValueError("unsupported order type")
  if type=="limit" and (limit_price is None or limit_price<=0): raise ValueError("limit_price required")
  if type=="stop_market" and (stop_price is None or stop_price<=0): raise ValueError("stop_price required")
  o={"id":self._next_order,"symbol":symbol,"side":side,"type":type,"quantity":quantity,"limitPrice":limit_price,"stopPrice":stop_price,"status":"PENDING","createdIndex":self.index,"filledPrice":None};self.orders[o["id"]]=o;self._next_order+=1;return o
 def _open(self,o,price,candle):
  symbol=o["symbol"];side="long" if o["side"]=="buy" else "short";fee=self.fee(price,o["quantity"]);need=price*o["quantity"]*self.margin_rate+fee
  self._recalc()
  if symbol in self.positions: raise ValueError("position already open")
  if self.account.available_margin<need: raise ValueError("insufficient margin")
  self.account.wallet_balance-=fee;self.account.total_fees+=fee;self.positions[symbol]={"symbol":symbol,"side":side,"quantity":o["quantity"],"entry_price":price,"current_price":price,"opened_at":candle.get("time"),"opened_index":self.index,"entry_fee":fee,"stop_loss":None,"take_profit":None,"stop_loss_created_index":-1,"take_profit_created_index":-1}
 def close(self,symbol,price,reason="MARKET",ambiguity="NONE",timestamp=None,quantity=None):
  if price<=0: raise ValueError("price must be positive")
  p=self.positions.get(symbol)
  if not p:return None
  qty=p["quantity"] if quantity is None else quantity
  if qty<=0 or qty>p["quantity"]: raise ValueError("invalid close quantity")
  gross=(price-p["entry_price"])*qty*(1 if p["side"]=="long" else -1);exit_fee=self.fee(price,qty);entry_fee=p["entry_fee"]*(qty/p["quantity"]);net=gross-entry_fee-exit_fee
  self.account.wallet_balance+=gross-exit_fee;self.account.realized_pnl+=net;self.account.total_fees+=exit_fee
  t={"id":len(self.trades)+1,"symbol":symbol,"side":p["side"].upper(),"quantity":qty,"entryPrice":p["entry_price"],"exitPrice":price,"openedAt":p["opened_at"],"closedAt":timestamp,"realizedPnL":net,"grossPnL":gross,"entryFee":entry_fee,"exitFee":exit_fee,"totalFee":entry_fee+exit_fee,"netPnL":net,"exitReason":reason,"ambiguityResolution":ambiguity};self.trades.append(t)
  if qty==p["quantity"]: del self.positions[symbol]
  else:
   p["quantity"]-=qty;p["entry_fee"]-=entry_fee
  self._recalc();return t
 def on_candle(self,candle,index=None,symbol="BTCUSD"):
  self.index=self.index+1 if index is None else index;events=[]
  for o in self.orders.values():
   if o["status"]!="PENDING" or o["symbol"]!=symbol:continue
   px=None
   if o["type"]=="market" and self.index>=o["createdIndex"]+2:px=candle["open"]
   elif o["type"]=="limit" and ((o["side"]=="buy" and candle["low"]<=o["limitPrice"]) or (o["side"]=="sell" and candle["high"]>=o["limitPrice"])):px=min(o["limitPrice"],candle["open"]) if o["side"]=="buy" else max(o["limitPrice"],candle["open"])
   elif o["type"]=="stop_market" and ((o["side"]=="buy" and candle["high"]>=o["stopPrice"]) or (o["side"]=="sell" and candle["low"]<=o["stopPrice"])):px=max(o["stopPrice"],candle["open"]) if o["side"]=="buy" else min(o["stopPrice"],candle["open"])
   if px is not None:
    try:self._open(o,px,candle);o["status"]="FILLED";o["filledPrice"]=px;events.append({"type":"ORDER_FILLED","order":o["id"]})
    except ValueError as e:o["status"]="REJECTED";events.append({"type":"ORDER_REJECTED","order":o["id"],"reason":str(e)})
  for sym,p in list(self.positions.items()):
   p["current_price"]=candle["close"];r=evaluate(p,candle,self.index)
   if r["triggered"]:events.append({"type":r["exitReason"],"trade":self.close(sym,r["exitPrice"],r["exitReason"],r["ambiguityResolution"],candle.get("time"))})
  self._recalc()
  for sym,p in list(self.positions.items()):
   if self.account.equity<=self.account.maintenance_margin:
    events.append({"type":"LIQUIDATION","trade":self.close(sym,candle["close"],"LIQUIDATION",timestamp=candle.get("time"))})
  return events
 def cancel(self,order_id):
  o=self.orders.get(order_id)
  if not o: raise ValueError("order not found")
  if o["status"]!="PENDING": raise ValueError("only pending orders can be cancelled")
  o["status"]="CANCELLED";return o
 def set_risk(self,symbol,stop_loss=None,take_profit=None):
  p=self.positions[symbol]
  if stop_loss is not None:p["stop_loss"]=stop_loss;p["stop_loss_created_index"]=self.index
  if take_profit is not None:p["take_profit"]=take_profit;p["take_profit_created_index"]=self.index
  return p
 def snapshot(self):self._recalc();return {"account":self.account.snapshot(),"positions":list(self.positions.values()),"orders":list(self.orders.values()),"trades":self.trades,"index":self.index}
