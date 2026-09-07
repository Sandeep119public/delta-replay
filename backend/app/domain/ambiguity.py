def evaluate(position,candle,candle_index,policy="CONSERVATIVE",execution_policy="SIMPLIFIED"):
    if position.get("opened_index",-1)>=candle_index:return {"triggered":False,"ambiguityResolution":"NONE","isAmbiguous":False}
    sl=position.get("stop_loss");tp=position.get("take_profit")
    sl_ok=sl is not None and position.get("stop_loss_created_index",-1)<candle_index
    tp_ok=tp is not None and position.get("take_profit_created_index",-1)<candle_index
    side=position["side"]; hit_sl=sl_ok and ((side=="long" and candle["low"]<=sl) or (side=="short" and candle["high"]>=sl));hit_tp=tp_ok and ((side=="long" and candle["high"]>=tp) or (side=="short" and candle["low"]<=tp))
    resolution="NONE";ambiguous=False
    if hit_sl and hit_tp:
        ambiguous=True
        if policy=="TP_FIRST": hit_sl=False;resolution="TP_FIRST"
        elif policy=="OPEN_PROXIMITY":
            resolution="HEURISTIC_PROXIMITY"
            if abs(candle["open"]-tp)<abs(candle["open"]-sl):hit_sl=False
            else:hit_tp=False
        else:hit_tp=False;resolution="SL_FIRST"
    if hit_sl:
        price=sl
        if execution_policy=="REALISTIC": price=candle["open"] if (side=="long" and candle["open"]<sl) or (side=="short" and candle["open"]>sl) else sl
        return {"triggered":True,"exitReason":"STOP_LOSS","exitPrice":price,"ambiguityResolution":resolution,"isAmbiguous":ambiguous}
    if hit_tp:
        price=tp
        if execution_policy=="REALISTIC": price=candle["open"] if (side=="long" and candle["open"]>tp) or (side=="short" and candle["open"]<tp) else tp
        return {"triggered":True,"exitReason":"TAKE_PROFIT","exitPrice":price,"ambiguityResolution":resolution,"isAmbiguous":ambiguous}
    return {"triggered":False,"ambiguityResolution":"NONE","isAmbiguous":False}
