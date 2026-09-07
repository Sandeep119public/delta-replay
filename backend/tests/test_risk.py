from app.domain.risk import evaluate_risk
def test_conservative_ambiguity_prefers_stop():
 p={"side":"long","stop_loss":90,"take_profit":110}
 assert evaluate_risk(p,{"low":89,"high":111})==("STOP_LOSS",90,True)
def test_short_take_profit():
 p={"side":"short","stop_loss":110,"take_profit":90}
 assert evaluate_risk(p,{"low":89,"high":105})==("TAKE_PROFIT",90,False)
