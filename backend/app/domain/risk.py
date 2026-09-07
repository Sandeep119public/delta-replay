def evaluate_risk(position,candle,policy="conservative"):
    sl=position.get("stop_loss");tp=position.get("take_profit")
    if position["side"]=="long": sl_hit=sl is not None and candle["low"]<=sl;tp_hit=tp is not None and candle["high"]>=tp
    else: sl_hit=sl is not None and candle["high"]>=sl;tp_hit=tp is not None and candle["low"]<=tp
    if sl_hit and tp_hit: return ("STOP_LOSS" if policy=="conservative" else "TAKE_PROFIT", sl if policy=="conservative" else tp,True)
    if sl_hit:return "STOP_LOSS",sl,False
    if tp_hit:return "TAKE_PROFIT",tp,False
    return None,None,False
