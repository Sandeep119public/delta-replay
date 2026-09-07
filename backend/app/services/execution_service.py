from ..domain.orders import Order
class ExecutionService:
    def __init__(self,trading): self.trading=trading; self.orders={}; self.pending=[]; self.next_id=1
    def place(self,symbol,side,quantity,type="market",limit_price=None,stop_price=None,index=-1):
        o=Order(self.next_id,symbol,side,type,quantity,limit_price=limit_price,stop_price=stop_price,created_index=index);self.next_id+=1;self.orders[o.id]=o;self.pending.append(o.id);return o
    def cancel(self,order_id):
        o=self.orders.get(order_id)
        if not o or o.status!="pending": return None
        o.status="cancelled";self.pending.remove(order_id);return o
    def process_candle(self,candle,index,symbol="BTCUSDT"):
        events=[]
        for oid in list(self.pending):
            o=self.orders[oid]
            if o.symbol!=symbol:continue
            price=None
            if o.type=="market" and o.created_index<index: price=candle["open"]
            elif o.type=="limit":
                if o.side=="buy" and candle["low"]<=o.limit_price: price=min(o.limit_price,candle["open"])
                if o.side=="sell" and candle["high"]>=o.limit_price: price=max(o.limit_price,candle["open"])
            elif o.type=="stop_market":
                if o.side=="buy" and candle["high"]>=o.stop_price: price=max(o.stop_price,candle["open"])
                if o.side=="sell" and candle["low"]<=o.stop_price: price=min(o.stop_price,candle["open"])
            if price is not None:
                try:self.trading.open_order(o,price);o.status="filled";o.filled_price=price;self.pending.remove(oid);events.append({"order":o.id,"status":"filled","price":price})
                except ValueError as e:o.status="rejected";self.pending.remove(oid);events.append({"order":o.id,"status":"rejected","reason":str(e)})
        return events
