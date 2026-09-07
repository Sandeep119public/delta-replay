import csv, io
class DataService:
    REQUIRED={"time","open","high","low","close"}
    def parse_csv(self,text:str):
        rows=list(csv.DictReader(io.StringIO(text)))
        if not rows: return []
        missing=self.REQUIRED-set(rows[0])
        if missing: raise ValueError("Missing columns: "+", ".join(sorted(missing)))
        return [{**{k:float(r[k]) for k in ("open","high","low","close")}, "time":int(float(r["time"])), "volume":float(r.get("volume") or 0)} for r in rows]
