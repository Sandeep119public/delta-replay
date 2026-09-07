from dataclasses import dataclass, field
from typing import Literal
@dataclass
class Order:
    id:int; symbol:str; side:Literal["buy","sell"]; type:Literal["market","limit","stop_market"]; quantity:float
    status:str="pending"; limit_price:float|None=None; stop_price:float|None=None; created_index:int=-1; filled_price:float|None=None
